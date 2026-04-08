window.DASHBOARD_CONFIG = {
    appId: "my-github-todo",
    firebase: {
        apiKey: "AIzaSyA9NGhnuq4Dsf4qq_JqIv1qlgoQ3ocvowM",
        authDomain: "mytodo-3fb4d.firebaseapp.com",
        projectId: "mytodo-3fb4d",
        storageBucket: "mytodo-3fb4d.firebasestorage.app",
        messagingSenderId: "5187329075",
        appId: "1:5187329075:web:d0ba327669c08534365746"
    },
    weather: {
        locationName: "서울",
        latitude: 37.5665,
        longitude: 126.9780,
        timezone: "Asia/Seoul"
    },
    schoolSchedule: {
        weekendMessage: "주말입니다. 학교 정규 시간표가 없습니다.",
        source: "./school/class.md",
        refreshMs: 60000
    },
    cram: {
        source: "./school/cram.md",
        refreshMs: 60000
    },
    githubSync: {
        api: "/api/memory-sync",
        repoUrl: "https://github.com/goodasa/goodasa.github.io",
        branch: "master",
        sourceDir: "smart-dashboard"
    },
    memoryDecks: {
        refreshMs: 60000,
        selectorApi: "/api/studyset-selection",
        english: {
            title: "StudySet 01",
            subject: "국어",
            source: "./memory/korean.md"
        },
        korean: {
            title: "StudySet 02",
            subject: "과학",
            source: "./memory/science.md"
        }
    }
};
