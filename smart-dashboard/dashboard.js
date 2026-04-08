(function () {
    "use strict";

    var config = window.DASHBOARD_CONFIG || {};
    var firebaseConfig = config.firebase || {};
    var weatherConfig = config.weather || {};
    var schoolConfig = config.schoolSchedule || { source: "./school/class.md", refreshMs: 60000, weekendMessage: "주말입니다." };
    var cramConfig = config.cram || { source: "./school/cram.md", refreshMs: 60000 };
    var syncConfig = config.githubSync || {
        api: "/api/memory-sync",
        repoUrl: "https://github.com/goodasa/goodasa.github.io",
        branch: "master",
        sourceDir: "smart-dashboard"
    };
    var memoryConfig = config.memoryDecks || {
        refreshMs: 60000,
        english: { title: "StudySet 01", subject: "영어", source: "./memory/english.md" },
        korean: { title: "StudySet 02", subject: "국어", source: "./memory/korean.md" }
    };
    var appId = config.appId || "my-github-todo";

    var state = {
        tasks: [],
        schoolItems: [],
        cramItems: [],
        unsubscribe: null,
        hasLoaded: false,
        currentDateKey: getLocalDateKey(new Date()),
        selectedStudySets: [],
        memorySyncPending: false,
        scheduleReloadTimerId: null,
        studysetWatchSource: null,
        studysetWatchSignature: "",
        toastTimerId: null,
        memorySlots: {
            english: createMemorySlotState(),
            korean: createMemorySlotState()
        }
    };

    var dom = {};

    document.addEventListener("DOMContentLoaded", function () {
        bindDom();
        applyConfigLabels();
        updateClock();
        window.setInterval(updateClock, 1000);
        scheduleDateBoundaryRefresh();
        initBurnInProtection();
        initConnectivityListeners();
        initDisplayMode();
        registerServiceWorker();
        initMemorySyncButton();
        initFirebase();
        fetchWeather();
        window.setInterval(fetchWeather, 30 * 60 * 1000);
        loadSchoolSchedule();
        loadCramSchedule();
        if (schoolConfig.refreshMs) {
            window.setInterval(loadSchoolSchedule, schoolConfig.refreshMs);
        }
        initStudySetAutoRefresh();
        if (cramConfig.refreshMs) {
            window.setInterval(loadCramSchedule, cramConfig.refreshMs);
        }
        renderTaskPanels();
    });

    function createMemorySlotState() {
        return {
            deck: null,
            timerId: null,
            selectionMeta: null,
            currentItems: [],
            lastSignature: ""
        };
    }

    function bindDom() {
        dom.time = document.getElementById("current-time");
        dom.date = document.getElementById("current-date");
        dom.statusDot = document.getElementById("status-dot");
        dom.statusLabel = document.getElementById("status-label");
        dom.lastSyncChip = document.getElementById("last-sync-chip");
        dom.displayModeChip = document.getElementById("display-mode-chip");
        dom.weatherLocationChip = document.getElementById("weather-location-chip");
        dom.memorySyncButton = document.getElementById("memory-sync-button");
        dom.dashboardToast = document.getElementById("dashboard-toast");
        dom.weatherStrip = document.getElementById("weather-strip");
        dom.summaryGrid = document.getElementById("summary-grid");
        dom.todayScheduleDay = document.getElementById("today-schedule-day");
        dom.schoolScheduleList = document.getElementById("school-schedule-list");
        dom.cramScheduleList = document.getElementById("cram-schedule-list");
        dom.schoolCount = document.getElementById("school-count");
        dom.cramCount = document.getElementById("cram-count");
        dom.appointmentPanel = document.getElementById("appointment-panel");
        dom.appointmentList = document.getElementById("appointment-list");
        dom.appointmentCount = document.getElementById("appointment-count");
        dom.todoPanel = document.getElementById("todo-panel");
        dom.todoList = document.getElementById("todo-list");
        dom.todoCount = document.getElementById("todo-count");
        dom.homeworkPanel = document.getElementById("homework-panel");
        dom.homeworkList = document.getElementById("homework-list");
        dom.homeworkCount = document.getElementById("homework-count");
        dom.memoryEnglishTitle = document.getElementById("memory-english-title");
        dom.memoryEnglishPhase = document.getElementById("memory-english-phase");
        dom.memoryEnglishList = document.getElementById("memory-english-list");
        dom.memoryKoreanTitle = document.getElementById("memory-korean-title");
        dom.memoryKoreanPhase = document.getElementById("memory-korean-phase");
        dom.memoryKoreanList = document.getElementById("memory-korean-list");
    }

    function applyConfigLabels() {
        dom.weatherLocationChip.textContent = weatherConfig.locationName || "서울";
        dom.memoryEnglishTitle.textContent = (memoryConfig.english && memoryConfig.english.title) || "StudySet 01";
        dom.memoryKoreanTitle.textContent = (memoryConfig.korean && memoryConfig.korean.title) || "StudySet 02";
    }

    function initMemorySyncButton() {
        if (!dom.memorySyncButton) {
            return;
        }

        if (location.protocol !== "http:" && location.protocol !== "https:") {
            dom.memorySyncButton.disabled = true;
            dom.memorySyncButton.textContent = "서버 필요";
            return;
        }

        dom.memorySyncButton.addEventListener("click", function () {
            if (state.memorySyncPending) {
                return;
            }
            triggerMemorySync();
        });
    }

    function initFirebase() {
        if (typeof firebase === "undefined") {
            updateConnectionStatus("offline", "Firebase SDK 로드 실패");
            dom.lastSyncChip.textContent = "오프라인";
            return;
        }

        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
        } catch (error) {
            console.error("Firebase init error:", error);
            updateConnectionStatus("offline", "Firebase 초기화 실패");
            dom.lastSyncChip.textContent = "초기화 오류";
            return;
        }

        var auth = firebase.auth();
        var db = firebase.firestore();

        auth.onAuthStateChanged(function (user) {
            if (!user) {
                return;
            }

            updateConnectionStatus("live", "Firebase 실시간 동기화 중");
            subscribeTodos(db);
        });

        authenticate(auth);
    }

    function authenticate(auth) {
        var customToken = typeof window.__initial_auth_token !== "undefined" ? window.__initial_auth_token : "";
        var promise = customToken ? auth.signInWithCustomToken(customToken) : auth.signInAnonymously();

        promise.catch(function (error) {
            console.error("Firebase auth error:", error);
            updateConnectionStatus("offline", "Firebase 인증 실패");
            dom.lastSyncChip.textContent = "인증 오류";
        });
    }

    function subscribeTodos(db) {
        if (state.unsubscribe) {
            state.unsubscribe();
        }

        var todosRef = db
            .collection("artifacts")
            .doc(appId)
            .collection("public")
            .doc("data")
            .collection("todos");

        state.unsubscribe = todosRef.onSnapshot(
            { includeMetadataChanges: true },
            function (snapshot) {
                state.tasks = snapshot.docs.map(function (doc) {
                    var data = doc.data();
                    data.id = doc.id;
                    return data;
                });
                state.hasLoaded = true;
                renderTaskPanels();

                if (snapshot.metadata.fromCache && !navigator.onLine) {
                    updateConnectionStatus("offline", "오프라인 캐시 표시 중");
                } else {
                    updateConnectionStatus("live", "Firebase 실시간 동기화 중");
                }

                dom.lastSyncChip.textContent = "업데이트 " + formatSyncTime(new Date());
            },
            function (error) {
                console.error("Firestore subscribe error:", error);
                updateConnectionStatus("offline", "실시간 연결 끊김");
                dom.lastSyncChip.textContent = "재연결 대기";
            }
        );
    }

    function fetchWeather() {
        renderWeatherLoading();

        var params = [
            "latitude=" + encodeURIComponent(weatherConfig.latitude),
            "longitude=" + encodeURIComponent(weatherConfig.longitude),
            "daily=weather_code,temperature_2m_max,temperature_2m_min",
            "forecast_days=2",
            "timezone=" + encodeURIComponent(weatherConfig.timezone || "Asia/Seoul")
        ].join("&");

        fetch("https://api.open-meteo.com/v1/forecast?" + params)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("weather_fetch_failed");
                }
                return response.json();
            })
            .then(renderWeather)
            .catch(function (error) {
                console.error("Weather fetch error:", error);
                renderWeatherError();
            });
    }

    function renderWeatherLoading() {
        dom.weatherStrip.innerHTML = [
            renderWeatherCompactItem("오늘", "...", "불러오는 중", "--", "--"),
            renderWeatherCompactItem("내일", "...", "불러오는 중", "--", "--")
        ].join("");
    }

    function renderWeather(data) {
        var daily = data && data.daily ? data.daily : null;
        if (!daily || !daily.time || daily.time.length < 2) {
            renderWeatherError();
            return;
        }

        dom.weatherStrip.innerHTML = [
            buildWeatherCompactItem("오늘", daily, 0),
            buildWeatherCompactItem("내일", daily, 1)
        ].join("");
    }

    function buildWeatherCompactItem(label, daily, index) {
        var code = daily.weather_code[index];
        var visual = getWeatherVisual(code);
        return renderWeatherCompactItem(
            label,
            visual.icon,
            visual.label,
            roundTemp(daily.temperature_2m_max[index]),
            roundTemp(daily.temperature_2m_min[index])
        );
    }

    function renderWeatherError() {
        dom.weatherStrip.innerHTML = [
            renderWeatherCompactItem("오늘", "?", "예보 실패", "--", "--"),
            renderWeatherCompactItem("내일", "?", "예보 실패", "--", "--")
        ].join("");
    }

    function renderWeatherCompactItem(day, icon, label, max, min) {
        return [
            '<div class="weather-compact-item">',
            '<span class="weather-compact-day">' + escapeHtml(day) + "</span>",
            '<span class="weather-compact-icon">' + escapeHtml(icon) + "</span>",
            '<span class="weather-compact-temp">' + escapeHtml(String(max)) + '°/' + escapeHtml(String(min)) + "°</span>",
            '<span class="weather-compact-summary">' + escapeHtml(label) + "</span>",
            "</div>"
        ].join("");
    }

    function loadSchoolSchedule() {
        var source = (schoolConfig && schoolConfig.source) || "./school/class.md";
        fetch(source + "?v=" + Date.now(), { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("school_fetch_failed");
                }
                return response.text();
            })
            .then(function (markdown) {
                if (!window.SchoolParser || typeof window.SchoolParser.parse !== "function") {
                    console.warn("SchoolParser utility is not loaded.");
                    state.schoolItems = [];
                } else {
                    state.schoolItems = window.SchoolParser.parse(markdown);
                }
                renderSchoolSchedule();
                queueStudySetReload();
            })
            .catch(function (error) {
                console.error("School schedule load error:", error);
                state.schoolItems = [];
                renderSchoolSchedule("학교 시간표 파일을 읽지 못했습니다.");
                queueStudySetReload();
            });
    }

    function loadCramSchedule() {
        var source = (cramConfig && cramConfig.source) || "./school/cram.md";
        fetch(source + "?v=" + Date.now(), { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("cram_fetch_failed");
                }
                return response.text();
            })
            .then(function (markdown) {
                if (!window.CramParser || typeof window.CramParser.parse !== "function") {
                    console.warn("CramParser utility is not loaded.");
                    state.cramItems = [];
                } else {
                    state.cramItems = window.CramParser.parse(markdown);
                }
                renderCramSchedule();
                queueStudySetReload();
            })
            .catch(function (error) {
                console.error("Cram schedule load error:", error);
                state.cramItems = [];
                renderCramSchedule("학원 일정 파일을 읽지 못했습니다.");
                queueStudySetReload();
            });
    }

    function queueStudySetReload() {
        if (state.scheduleReloadTimerId) {
            window.clearTimeout(state.scheduleReloadTimerId);
        }

        state.scheduleReloadTimerId = window.setTimeout(function () {
            state.scheduleReloadTimerId = null;
            loadMemoryDecks();
        }, 80);
    }

    function loadMemoryDecks() {
        requestStudySetSelection()
            .then(function (selection) {
                applyStudySetSelection(selection);
            })
            .catch(function (error) {
                console.error("StudySet selection error:", error);
                state.selectedStudySets = [];
                loadMemoryDeck("english", {
                    slotTitle: (memoryConfig.english && memoryConfig.english.title) || "StudySet 01",
                    source: (memoryConfig.english && memoryConfig.english.source) || "./memory/english.md",
                    subject: (memoryConfig.english && memoryConfig.english.subject) || "영어",
                    reason: "기본 파일을 불러왔습니다."
                });
                loadMemoryDeck("korean", {
                    slotTitle: (memoryConfig.korean && memoryConfig.korean.title) || "StudySet 02",
                    source: (memoryConfig.korean && memoryConfig.korean.source) || "./memory/korean.md",
                    subject: (memoryConfig.korean && memoryConfig.korean.subject) || "국어",
                    reason: "기본 파일을 불러왔습니다."
                });
            });
    }

    function requestStudySetSelection() {
        var apiPath = memoryConfig.selectorApi || "/api/studyset-selection";
        var payload = {
            date: state.currentDateKey,
            weekday: getWeekdayKey(new Date().getDay()),
            schoolSubjects: getTodaySchoolSubjects(),
            cramSubjects: getTodayCramSubjects()
        };

        return fetch(apiPath + "?v=" + Date.now(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            cache: "no-store",
            body: JSON.stringify(payload)
        }).then(function (response) {
            if (!response.ok) {
                throw new Error("studyset_selection_failed");
            }
            return response.json();
        }).then(function (data) {
            if (!data || !data.ok || !data.files || data.files.length < 2) {
                throw new Error("studyset_selection_invalid");
            }
            return data;
        });
    }

    function triggerMemorySync() {
        var apiPath = syncConfig.api || "/api/memory-sync";
        var payload = {
            repoUrl: syncConfig.repoUrl || "https://github.com/goodasa/goodasa.github.io",
            branch: syncConfig.branch || "master",
            sourceDir: syncConfig.sourceDir || "smart-dashboard"
        };

        state.memorySyncPending = true;
        dom.memorySyncButton.disabled = true;
        dom.memorySyncButton.textContent = "업데이트 중";

        fetch(apiPath + "?v=" + Date.now(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            cache: "no-store",
            body: JSON.stringify(payload)
        }).then(function (response) {
            return response.json().catch(function () {
                return {
                    ok: false,
                    message: "업데이트 응답을 읽지 못했습니다."
                };
            }).then(function (data) {
                data.__httpOk = response.ok;
                return data;
            });
        }).then(function (data) {
            if (!data.__httpOk || !data.ok) {
                throw new Error(data.message || "업데이트에 실패했습니다.");
            }

            showDashboardToast(data.message || "업데이트 성공", "success");
            state.studysetWatchSignature = "";
            loadMemoryDecks();
        }).catch(function (error) {
            console.error("Memory sync error:", error);
            showDashboardToast(error.message || "업데이트에 실패했습니다.", "error");
        }).finally(function () {
            state.memorySyncPending = false;
            dom.memorySyncButton.disabled = false;
            dom.memorySyncButton.textContent = "업데이트";
        });
    }

    function showDashboardToast(message, tone) {
        if (!dom.dashboardToast) {
            return;
        }

        if (state.toastTimerId) {
            window.clearTimeout(state.toastTimerId);
            state.toastTimerId = null;
        }

        dom.dashboardToast.textContent = message;
        dom.dashboardToast.className = "dashboard-toast is-visible " + (tone === "error" ? "is-error" : "is-success");

        state.toastTimerId = window.setTimeout(function () {
            dom.dashboardToast.className = "dashboard-toast";
        }, 3200);
    }

    function initStudySetAutoRefresh() {
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) {
                loadMemoryDecks();
            }
        });

        window.addEventListener("focus", function () {
            loadMemoryDecks();
        });

        if (!window.EventSource) {
            return;
        }

        if (location.protocol !== "http:" && location.protocol !== "https:") {
            return;
        }

        connectStudySetWatch();
    }

    function connectStudySetWatch() {
        var eventSource = new window.EventSource("./api/studyset-watch?v=" + Date.now());
        state.studysetWatchSource = eventSource;

        eventSource.addEventListener("studyset-change", function (event) {
            var payload;
            try {
                payload = JSON.parse(event.data || "{}");
            } catch (error) {
                console.error("StudySet watch payload parse error:", error);
                return;
            }

            if (!payload || !payload.signature) {
                return;
            }

            if (!state.studysetWatchSignature) {
                state.studysetWatchSignature = payload.signature;
                return;
            }

            if (payload.signature === state.studysetWatchSignature) {
                return;
            }

            state.studysetWatchSignature = payload.signature;
            loadMemoryDecks();
        });

        eventSource.onerror = function () {
            if (state.studysetWatchSource) {
                state.studysetWatchSource.close();
                state.studysetWatchSource = null;
            }

            window.setTimeout(function () {
                if (!state.studysetWatchSource) {
                    connectStudySetWatch();
                }
            }, 5000);
        };
    }

    function applyStudySetSelection(selection) {
        var files = selection.files || [];
        state.selectedStudySets = files;
        loadMemoryDeck("english", files[0] || {
            slotTitle: (memoryConfig.english && memoryConfig.english.title) || "StudySet 01",
            source: (memoryConfig.english && memoryConfig.english.source) || "./memory/english.md",
            subject: (memoryConfig.english && memoryConfig.english.subject) || "영어",
            reason: selection.selectionNote || ""
        });
        loadMemoryDeck("korean", files[1] || {
            slotTitle: (memoryConfig.korean && memoryConfig.korean.title) || "StudySet 02",
            source: (memoryConfig.korean && memoryConfig.korean.source) || "./memory/korean.md",
            subject: (memoryConfig.korean && memoryConfig.korean.subject) || "국어",
            reason: selection.selectionNote || ""
        });
    }

    function loadMemoryDeck(key, selectedMeta) {
        var slotConfig = memoryConfig[key] || {};
        var source = (selectedMeta && (selectedMeta.relativePath || selectedMeta.source)) || slotConfig.source;
        if (!source) {
            renderMemoryMessage(key, "암기 파일이 없습니다.");
            return;
        }

        fetch(source + "?v=" + Date.now(), { cache: "no-store" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("memory_fetch_failed");
                }
                return response.text();
            })
            .then(function (markdown) {
                var parsed;
                if (!window.MemoryDeckParser || typeof window.MemoryDeckParser.parse !== "function") {
                    console.warn("MemoryDeckParser utility is not loaded.");
                    parsed = { subject: slotConfig.subject || "", intervalSeconds: 3, items: [] };
                } else {
                    parsed = window.MemoryDeckParser.parse(markdown);
                }

                state.memorySlots[key].deck = {
                    slotTitle: (selectedMeta && selectedMeta.slotTitle) || slotConfig.title || "StudySet",
                    title: parsed.title || (selectedMeta && selectedMeta.title) || slotConfig.title || "암기",
                    subject: parsed.subject || (selectedMeta && selectedMeta.subject) || slotConfig.subject || "",
                    category: parsed.category || "",
                    tags: parsed.tags || [],
                    intervalSeconds: Math.max(1, Number(parsed.intervalSeconds || slotConfig.intervalSeconds || (selectedMeta && selectedMeta.intervalSeconds) || 3)),
                    items: (parsed.items || []).map(function (item, index) {
                        return {
                            id: item.id || key + "-" + index,
                            front: item.front,
                            back: item.back,
                            illustration: resolveMemoryIllustrationPath(item.illustration, source)
                        };
                    }),
                    reason: (selectedMeta && selectedMeta.reason) || ""
                };
                state.memorySlots[key].selectionMeta = selectedMeta || null;

                restartMemoryRotation(key);
            })
            .catch(function (error) {
                console.error("Memory deck load error:", key, error);
                state.memorySlots[key].deck = null;
                state.memorySlots[key].selectionMeta = selectedMeta || null;
                restartMemoryRotation(key, "암기 파일을 읽지 못했습니다.");
            });
    }

    function restartMemoryRotation(key, customMessage) {
        var slot = state.memorySlots[key];
        clearMemoryTimer(slot);
        slot.currentItems = [];
        slot.lastSignature = "";

        if (customMessage) {
            renderMemoryMessage(key, customMessage);
            return;
        }

        if (!slot.deck || !slot.deck.items.length) {
            renderMemoryMessage(key, "암기 카드가 없습니다.");
            return;
        }

        chooseNextMemoryItems(key);
        renderMemorySlot(key);
        slot.timerId = window.setInterval(function () {
            advanceMemorySlot(key);
        }, slot.deck.intervalSeconds * 1000);
    }

    function clearMemoryTimer(slot) {
        if (slot && slot.timerId) {
            window.clearInterval(slot.timerId);
            slot.timerId = null;
        }
    }

    function advanceMemorySlot(key) {
        var slot = state.memorySlots[key];
        if (!slot.deck || !slot.deck.items.length) {
            return;
        }

        chooseNextMemoryItems(key);
        renderMemorySlot(key);
    }

    function chooseNextMemoryItems(key) {
        var slot = state.memorySlots[key];
        var items = slot.deck ? slot.deck.items.slice() : [];
        var pair = [];
        var previousSignature = slot.lastSignature;
        var attempts = 0;

        if (!items.length) {
            slot.currentItems = [];
            slot.lastSignature = "";
            return;
        }

        if (items.length <= 2) {
            slot.currentItems = items;
            slot.lastSignature = buildMemorySignature(items);
            return;
        }

        while (attempts < 12) {
            pair = pickRandomItems(items, 2);
            slot.lastSignature = buildMemorySignature(pair);
            if (slot.lastSignature !== previousSignature) {
                slot.currentItems = pair;
                return;
            }
            attempts += 1;
        }

        slot.currentItems = pair.length ? pair : items.slice(0, 2);
        slot.lastSignature = buildMemorySignature(slot.currentItems);
    }

    function pickRandomItems(items, count) {
        var pool = items.slice();
        var result = [];

        while (pool.length && result.length < count) {
            var index = Math.floor(Math.random() * pool.length);
            result.push(pool.splice(index, 1)[0]);
        }

        return result;
    }

    function buildMemorySignature(items) {
        return (items || [])
            .map(function (item) {
                return item.id;
            })
            .sort()
            .join("|");
    }

    function resolveMemoryIllustrationPath(rawPath, source) {
        var cleaned = String(rawPath || "").trim();
        var baseUrl;

        if (!cleaned || cleaned === "-") {
            return "";
        }

        if (/!\[[^\]]*\]\((.+?)\)/u.test(cleaned)) {
            cleaned = cleaned.replace(/!\[[^\]]*\]\((.+?)\)/u, "$1").trim();
        }

        try {
            if (/^(https?:)?\/\//u.test(cleaned) || cleaned.indexOf("/") === 0) {
                return new URL(cleaned, window.location.href).href;
            }

            if (/^\.?\/?memory\//u.test(cleaned)) {
                return new URL(cleaned.replace(/^\.?\//u, ""), window.location.href).href;
            }

            baseUrl = new URL(source || window.location.href, window.location.href);
            return new URL(cleaned, baseUrl).href;
        } catch (error) {
            console.warn("Memory illustration path resolve error:", cleaned, error);
            return "";
        }
    }

    function renderMemorySlot(key) {
        var slot = state.memorySlots[key];
        var domRefs = getMemoryDom(key);
        var slotConfig = memoryConfig[key] || {};
        var deck = slot.deck || { slotTitle: slotConfig.title || "StudySet", title: slotConfig.title || "암기", subject: slotConfig.subject || "", intervalSeconds: 3, items: [] };
        var metaParts = [deck.subject || deck.title, String(deck.intervalSeconds) + "초"];

        domRefs.title.textContent = deck.slotTitle || slotConfig.title || "StudySet";
        domRefs.phase.textContent = metaParts.filter(Boolean).join(" · ");

        if (!slot.currentItems.length) {
            renderMemoryMessage(key, "암기 카드가 없습니다.");
            return;
        }

        domRefs.list.className = "memory-grid";
        domRefs.list.innerHTML = slot.currentItems.map(function (item, index) {
            var toneClass = key === "english" ? "memory-card is-english" : "memory-card is-korean";
            var hasIllustration = !!item.illustration;
            return [
                '<article class="' + toneClass + (hasIllustration ? ' has-figure' : "") + '">',
                '<span class="memory-card-label">카드 ' + escapeHtml(String(index + 1)) + "</span>",
                '<div class="memory-card-copy">',
                '<strong class="memory-card-front">' + escapeHtml(item.front) + "</strong>",
                '<span class="memory-card-back">' + escapeHtml(item.back) + "</span>",
                '</div>',
                hasIllustration
                    ? '<div class="memory-card-figure"><img class="memory-card-image" src="' + escapeHtml(item.illustration) + '" alt="' + escapeHtml(item.front + " 도해") + '" loading="eager"></div>'
                    : "",
                "</article>"
            ].join("");
        }).join("");

        attachMemoryImageFallbacks(domRefs.list);
    }

    function renderMemoryMessage(key, message) {
        var domRefs = getMemoryDom(key);
        var slotConfig = memoryConfig[key] || {};
        domRefs.title.textContent = slotConfig.title || "StudySet";
        domRefs.phase.textContent = [slotConfig.subject || "", "대기"].filter(Boolean).join(" · ");
        domRefs.list.className = "memory-grid compact-empty memory-empty";
        domRefs.list.textContent = message;
    }

    function getTodaySchoolSubjects() {
        return getTodaySchoolItems().map(function (item) {
            return item.title || item.subject || "";
        }).filter(Boolean);
    }

    function getTodaySchoolItems() {
        var today = new Date().getDay();
        var dayKey = getWeekdayKey(today);
        return window.SchoolParser && typeof window.SchoolParser.filterByDay === "function"
            ? window.SchoolParser.filterByDay(state.schoolItems, dayKey)
            : [];
    }

    function getTodayCramSubjects() {
        var today = new Date().getDay();
        var dayKey = getWeekdayKey(today);
        var items = window.CramParser && typeof window.CramParser.filterByDay === "function"
            ? window.CramParser.filterByDay(state.cramItems, dayKey)
            : [];

        return items.map(function (item) {
            return item.title || "";
        }).filter(Boolean);
    }

    function getMemoryDom(key) {
        if (key === "english") {
            return {
                title: dom.memoryEnglishTitle,
                phase: dom.memoryEnglishPhase,
                list: dom.memoryEnglishList
            };
        }

        return {
            title: dom.memoryKoreanTitle,
            phase: dom.memoryKoreanPhase,
            list: dom.memoryKoreanList
        };
    }

    function attachMemoryImageFallbacks(container) {
        Array.prototype.forEach.call(container.querySelectorAll(".memory-card-image"), function (image) {
            image.addEventListener("error", function () {
                var figure = image.closest(".memory-card-figure");
                var card = image.closest(".memory-card");
                if (figure) {
                    figure.remove();
                }
                if (card) {
                    card.classList.remove("has-figure");
                }
            }, { once: true });
        });
    }

    function renderSchoolSchedule(customMessage) {
        var today = new Date().getDay();
        var items = getTodaySchoolItems().slice();

        dom.todayScheduleDay.textContent = getWeekdayTitle(today);
        items.sort(compareScheduleItems);
        dom.schoolCount.textContent = String(items.length);

        if (customMessage) {
            renderCompactMessage(dom.schoolScheduleList, customMessage);
            return;
        }

        if (today === 0 || today === 6) {
            renderCompactMessage(dom.schoolScheduleList, schoolConfig.weekendMessage || "주말입니다.");
            return;
        }

        if (!items.length) {
            renderCompactMessage(dom.schoolScheduleList, "학교 시간표가 없습니다.");
            return;
        }

        dom.schoolScheduleList.className = "schedule-dense-list";
        dom.schoolScheduleList.innerHTML = items.map(function (item) {
            return renderScheduleRow(item, false);
        }).join("");
    }

    function renderCramSchedule(customMessage) {
        var today = new Date().getDay();
        var dayKey = getWeekdayKey(today);
        var items = window.CramParser && typeof window.CramParser.filterByDay === "function"
            ? window.CramParser.filterByDay(state.cramItems, dayKey)
            : [];

        dom.cramCount.textContent = String(items.length);

        if (customMessage) {
            renderCompactMessage(dom.cramScheduleList, customMessage);
            return;
        }

        if (today === 0 || today === 6) {
            renderCompactMessage(dom.cramScheduleList, "학원 일정 없음");
            return;
        }

        if (!items.length) {
            renderCompactMessage(dom.cramScheduleList, "학원 일정 없음");
            return;
        }

        dom.cramScheduleList.className = "schedule-dense-list";
        dom.cramScheduleList.innerHTML = items.map(function (item) {
            return renderScheduleRow(item, true);
        }).join("");
    }

    function renderScheduleRow(item, isCram) {
        var timeLabel = item.endTime ? item.startTime + "-" + item.endTime : item.startTime;
        var rowClass = isCram ? "schedule-row is-cram" : "schedule-row";
        return [
            '<div class="' + rowClass + '">',
            '<span class="schedule-time">' + escapeHtml(timeLabel || "--:--") + "</span>",
            '<span class="schedule-title">' + escapeHtml(item.title || item.subject || "일정") + "</span>",
            "</div>"
        ].join("");
    }

    function renderTaskPanels() {
        var grouped = groupTasks(state.tasks, state.currentDateKey);
        renderSummary(grouped);
        renderDensePanel(dom.appointmentPanel, dom.appointmentList, dom.appointmentCount, grouped.appointment, "약속과 모임이 없습니다.");
        renderDensePanel(dom.todoPanel, dom.todoList, dom.todoCount, grouped.todo, "할일이 없습니다.");
        renderDensePanel(dom.homeworkPanel, dom.homeworkList, dom.homeworkCount, grouped.homework, "숙제가 없습니다.");
    }

    function renderSummary(grouped) {
        dom.summaryGrid.innerHTML = [
            renderStatBlock("전체", grouped.allCount, ""),
            renderStatBlock("마감", grouped.todayDue, ""),
            renderStatBlock("약속", grouped.appointment.length, ""),
            renderStatBlock("지연", grouped.overdue, "danger")
        ].join("");
    }

    function renderStatBlock(label, value, extraClass) {
        return [
            '<article class="stat-block">',
            '<span class="stat-label">' + escapeHtml(label) + "</span>",
            '<strong class="stat-value ' + extraClass + '">' + escapeHtml(String(value)) + "</strong>",
            "</article>"
        ].join("");
    }

    function renderDensePanel(panelElement, listElement, countElement, items, emptyMessage) {
        countElement.textContent = String(items.length);

        if (!state.hasLoaded) {
            panelElement.classList.add("panel-auto");
            renderCompactMessage(listElement, "불러오는 중입니다.");
            return;
        }

        if (!items.length) {
            panelElement.classList.add("panel-auto");
            renderCompactMessage(listElement, emptyMessage);
            return;
        }

        if (panelElement.id === "todo-panel") {
            panelElement.classList.remove("panel-auto");
        } else {
            panelElement.classList.add("panel-auto");
        }

        listElement.className = "dense-list";
        listElement.innerHTML = items.map(renderDenseRow).join("");
    }

    function renderCompactMessage(element, message) {
        element.className = element.id.indexOf("schedule") >= 0 ? "schedule-dense-list compact-empty" : "dense-list compact-empty";
        element.textContent = message;
    }

    function renderDenseRow(task) {
        var status = getStatusInfo(task);
        var meta = buildDenseMeta(task, status);
        var rowClass = status.key === "overdue" ? "dense-row is-overdue" : "dense-row";

        return [
            '<article class="' + rowClass + '">',
            '<span class="state-badge ' + status.key + '">' + escapeHtml(status.label) + "</span>",
            '<span class="dense-row-title">' + escapeHtml(task.task || "제목 없는 항목") + "</span>",
            '<span class="dense-row-meta">' + escapeHtml(meta) + "</span>",
            "</article>"
        ].join("");
    }

    function buildDenseMeta(task, status) {
        var parts = [];
        if (task.dueDate) {
            parts.push(status.dateLabel);
        }
        if (task.assignee) {
            parts.push(task.assignee);
        }
        return parts.join(" · ") || "정보 없음";
    }

    function groupTasks(tasks, todayKey) {
        var result = {
            homework: [],
            todo: [],
            appointment: [],
            allCount: 0,
            todayDue: 0,
            overdue: 0
        };

        tasks.forEach(function (task) {
            if (task.completed) {
                return;
            }

            var normalized = normalizeCategory(task.category);
            var dueState = getDueState(task.dueDate, todayKey);
            result.allCount += 1;

            if (dueState === "today") {
                result.todayDue += 1;
            }
            if (dueState === "overdue") {
                result.overdue += 1;
            }

            if (normalized === "homework") {
                result.homework.push(task);
                return;
            }

            if (normalized === "todo") {
                result.todo.push(task);
                return;
            }

            result.appointment.push(task);
        });

        result.homework.sort(compareTaskPriority);
        result.todo.sort(compareTaskPriority);
        result.appointment.sort(compareTaskPriority);
        return result;
    }

    function normalizeCategory(category) {
        if (category === "숙제") {
            return "homework";
        }
        if (category === "할일") {
            return "todo";
        }
        return "appointment";
    }

    function compareTaskPriority(a, b) {
        var pa = getStatusPriority(a);
        var pb = getStatusPriority(b);

        if (pa !== pb) {
            return pa - pb;
        }

        var dueA = parseDateKey(a.dueDate);
        var dueB = parseDateKey(b.dueDate);
        if (dueA !== dueB) {
            return dueA - dueB;
        }

        return (b.createdAt || 0) - (a.createdAt || 0);
    }

    function compareScheduleItems(a, b) {
        return parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime);
    }

    function getStatusPriority(task) {
        var dueState = getDueState(task.dueDate, state.currentDateKey);
        if (dueState === "overdue") {
            return 0;
        }
        if (dueState === "today") {
            return 1;
        }
        return 2;
    }

    function getStatusInfo(task) {
        var dueState = getDueState(task.dueDate, state.currentDateKey);
        if (dueState === "overdue") {
            return { key: "overdue", label: "지연", dateLabel: formatDateShort(task.dueDate) };
        }
        if (dueState === "today") {
            return { key: "today", label: "오늘", dateLabel: "오늘" };
        }
        return { key: "future", label: "예정", dateLabel: formatDateShort(task.dueDate) };
    }

    function getDueState(dueDate, todayKey) {
        if (!dueDate) {
            return "future";
        }
        if (dueDate === todayKey) {
            return "today";
        }
        return dueDate < todayKey ? "overdue" : "future";
    }

    function updateClock() {
        var now = new Date();
        dom.time.textContent = new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(now);
        dom.date.textContent = new Intl.DateTimeFormat("ko-KR", {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short"
        }).format(now);
    }

    function scheduleDateBoundaryRefresh() {
        var now = new Date();
        var tomorrow = new Date(now);
        tomorrow.setHours(24, 0, 5, 0);
        var waitMs = tomorrow.getTime() - now.getTime();

        window.setTimeout(function () {
            state.currentDateKey = getLocalDateKey(new Date());
            updateClock();
            renderSchoolSchedule();
            renderCramSchedule();
            renderTaskPanels();
            loadMemoryDecks();
            fetchWeather();
            scheduleDateBoundaryRefresh();
        }, waitMs);
    }

    function initBurnInProtection() {
        applyBurnInOffset();
        window.setInterval(applyBurnInOffset, 60 * 60 * 1000);
    }

    function applyBurnInOffset() {
        var x = Math.floor(Math.random() * 5) - 2;
        var y = Math.floor(Math.random() * 5) - 2;
        document.documentElement.style.setProperty("--screen-shift-x", x + "px");
        document.documentElement.style.setProperty("--screen-shift-y", y + "px");
    }

    function initConnectivityListeners() {
        window.addEventListener("online", function () {
            updateConnectionStatus("live", "네트워크 복구됨");
        });
        window.addEventListener("offline", function () {
            updateConnectionStatus("offline", "오프라인 상태");
        });
    }

    function updateConnectionStatus(status, label) {
        dom.statusDot.classList.remove("live", "offline");
        if (status === "live") {
            dom.statusDot.classList.add("live");
        }
        if (status === "offline") {
            dom.statusDot.classList.add("offline");
        }
        dom.statusLabel.textContent = label;
    }

    function initDisplayMode() {
        var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
        if (location.protocol === "file:") {
            dom.displayModeChip.textContent = "파일 모드";
            return;
        }
        dom.displayModeChip.textContent = standalone ? "앱 모드" : "브라우저 모드";
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) {
            return;
        }
        if (location.protocol !== "http:" && location.protocol !== "https:") {
            return;
        }
        navigator.serviceWorker.register("./sw.js?v=20260407-4").catch(function (error) {
            console.error("Service worker registration failed:", error);
        });
    }

    function formatSyncTime(date) {
        return new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(date);
    }

    function getLocalDateKey(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, "0");
        var day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
    }

    function parseDateKey(dateKey) {
        if (!dateKey) {
            return Number.MAX_SAFE_INTEGER;
        }
        return new Date(dateKey + "T00:00:00").getTime();
    }

    function formatDateShort(dateKey) {
        if (!dateKey) {
            return "미정";
        }
        var date = new Date(dateKey + "T00:00:00");
        return new Intl.DateTimeFormat("ko-KR", {
            month: "numeric",
            day: "numeric"
        }).format(date);
    }

    function parseTimeToMinutes(timeText) {
        if (!timeText) {
            return Number.MAX_SAFE_INTEGER;
        }
        var parts = timeText.split(":");
        return Number(parts[0]) * 60 + Number(parts[1]);
    }

    function roundTemp(value) {
        return Math.round(Number(value));
    }

    function getWeekdayTitle(day) {
        var labels = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
        return labels[day] || "오늘";
    }

    function getWeekdayKey(day) {
        var keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        return keys[day] || "monday";
    }

    function getWeatherVisual(code) {
        if (code === 0) {
            return { icon: "☀", label: "맑음" };
        }
        if (code === 1 || code === 2) {
            return { icon: "⛅", label: "구름 조금" };
        }
        if (code === 3) {
            return { icon: "☁", label: "흐림" };
        }
        if (code === 45 || code === 48) {
            return { icon: "🌫", label: "안개" };
        }
        if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
            return { icon: "🌦", label: "이슬비" };
        }
        if (code === 61 || code === 63 || code === 65 || code === 66 || code === 67 || code === 80 || code === 81 || code === 82) {
            return { icon: "🌧", label: "비" };
        }
        if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) {
            return { icon: "❄", label: "눈" };
        }
        if (code === 95 || code === 96 || code === 99) {
            return { icon: "⛈", label: "번개" };
        }
        return { icon: "☁", label: "날씨" };
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
