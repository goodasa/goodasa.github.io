(function () {
    "use strict";

    var dayMap = {
        "월요일": "monday",
        "화요일": "tuesday",
        "수요일": "wednesday",
        "목요일": "thursday",
        "금요일": "friday",
        "토요일": "saturday",
        "일요일": "sunday"
    };

    function parse(markdown) {
        var lines = String(markdown || "").split(/\r?\n/);
        var currentDay = null;
        var results = [];

        lines.forEach(function (rawLine, index) {
            var line = rawLine.trim();
            if (!line) {
                return;
            }

            if (/^#\s+/u.test(line)) {
                return;
            }

            var dayMatch = line.match(/^##\s*(월요일|화요일|수요일|목요일|금요일|토요일|일요일)\s*$/u);
            if (dayMatch) {
                currentDay = dayMap[dayMatch[1]] || null;
                return;
            }

            var itemMatch = line.match(/^-\s*(\d{2}:\d{2})-(\d{2}:\d{2})\s*\|\s*(.+?)\s*$/u);
            if (itemMatch) {
                if (!currentDay) {
                    console.warn("[cram-parser] 요일 헤더 없이 일정이 나왔습니다:", line, "line:", index + 1);
                    return;
                }

                results.push({
                    day: currentDay,
                    startTime: itemMatch[1],
                    endTime: itemMatch[2],
                    title: itemMatch[3]
                });
                return;
            }

            console.warn("[cram-parser] 형식이 잘못된 줄을 무시합니다:", line, "line:", index + 1);
        });

        return results;
    }

    function filterByDay(items, day) {
        return (items || [])
            .filter(function (item) {
                return item.day === day;
            })
            .sort(function (a, b) {
                return parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime);
            });
    }

    function parseTimeToMinutes(timeText) {
        if (!timeText) {
            return Number.MAX_SAFE_INTEGER;
        }
        var parts = timeText.split(":");
        return Number(parts[0]) * 60 + Number(parts[1]);
    }

    window.CramParser = {
        parse: parse,
        filterByDay: filterByDay
    };
})();
