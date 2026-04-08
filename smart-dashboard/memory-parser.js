(function () {
    "use strict";

    var WORD_HEADER_NAMES = ["단어"];
    var MEANING_HEADER_NAMES = ["의미"];
    var PROMPT_HEADER_NAMES = ["프롬프트", "이미지프롬프트", "생성프롬프트", "이미지생성프롬프트"];
    var IMAGE_HEADER_NAMES = ["도해", "관련이미지", "관련그림", "이미지", "이미지링크", "이미지주소", "그림", "링크"];

    function splitTableCells(line) {
        if (!/^\|.+\|$/u.test(line)) {
            return null;
        }

        return line
            .replace(/^\|/u, "")
            .replace(/\|$/u, "")
            .split("|")
            .map(function (cell) {
                return cell.trim();
            });
    }

    function normalizeHeaderName(value) {
        return String(value || "").replace(/\s+/gu, "").trim().toLowerCase();
    }

    function findHeaderIndex(cells, allowedNames) {
        var normalizedAllowed = allowedNames.map(function (name) {
            return normalizeHeaderName(name);
        });
        var index = -1;

        cells.some(function (cell, cellIndex) {
            if (normalizedAllowed.indexOf(normalizeHeaderName(cell)) >= 0) {
                index = cellIndex;
                return true;
            }
            return false;
        });

        return index;
    }

    function getHeaderMap(cells) {
        var wordIndex = findHeaderIndex(cells, WORD_HEADER_NAMES);
        var meaningIndex = findHeaderIndex(cells, MEANING_HEADER_NAMES);
        var promptIndex = findHeaderIndex(cells, PROMPT_HEADER_NAMES);
        var imageIndex = findHeaderIndex(cells, IMAGE_HEADER_NAMES);

        if (wordIndex < 0 || meaningIndex < 0) {
            return null;
        }

        if (imageIndex < 0 && cells.length === 3) {
            imageIndex = 2;
        }

        return {
            wordIndex: wordIndex,
            meaningIndex: meaningIndex,
            promptIndex: promptIndex,
            imageIndex: imageIndex
        };
    }

    function isTableSeparator(cells) {
        return cells.length >= 3 && cells.every(function (cell) {
            return /^:?-{3,}:?$/u.test(cell) || cell === "";
        });
    }

    function extractIllustrationValue(rawValue) {
        var value = String(rawValue || "").trim();
        var imageMatch;
        var htmlImageMatch;

        if (!value || value === "-") {
            return "";
        }

        htmlImageMatch = value.match(/<img\b[^>]*\bsrc=["'](.+?)["'][^>]*>/iu);
        if (htmlImageMatch) {
            return htmlImageMatch[1].trim();
        }

        imageMatch = value.match(/!\[[^\]]*\]\((.+?)\)/u);
        if (imageMatch) {
            return imageMatch[1].trim();
        }

        return value;
    }

    function getCellValue(cells, index) {
        if (index < 0 || index >= cells.length) {
            return "";
        }
        return cells[index];
    }

    function parse(markdown) {
        var lines = String(markdown || "").split(/\r?\n/);
        var result = {
            title: "",
            subject: "",
            category: "",
            tags: [],
            priority: 5,
            intervalSeconds: 3,
            items: []
        };
        var hasMemoryTable = false;
        var headerMap = null;

        lines.forEach(function (rawLine, index) {
            var line = rawLine.trim();
            var match;
            var cells;

            if (!line) {
                return;
            }

            if (/^#\s+/u.test(line)) {
                return;
            }

            match = line.match(/^@title:\s*(.+?)\s*$/u);
            if (match) {
                result.title = match[1];
                return;
            }

            match = line.match(/^@subject:\s*(.+?)\s*$/u);
            if (match) {
                result.subject = match[1];
                return;
            }

            match = line.match(/^@category:\s*(.+?)\s*$/u);
            if (match) {
                result.category = match[1];
                return;
            }

            match = line.match(/^@tags:\s*(.+?)\s*$/u);
            if (match) {
                result.tags = match[1].split(",").map(function (tag) {
                    return tag.trim();
                }).filter(Boolean);
                return;
            }

            match = line.match(/^@priority:\s*(\d+)\s*$/u);
            if (match) {
                result.priority = Math.max(1, Math.min(10, Number(match[1]) || 5));
                return;
            }

            match = line.match(/^@interval:\s*(\d+(?:\.\d+)?)\s*$/u);
            if (match) {
                result.intervalSeconds = Math.max(1, Number(match[1]) || 3);
                return;
            }

            cells = splitTableCells(line);
            if (cells) {
                var detectedHeaderMap = getHeaderMap(cells);
                if (detectedHeaderMap) {
                    hasMemoryTable = true;
                    headerMap = detectedHeaderMap;
                    return;
                }

                if (hasMemoryTable && isTableSeparator(cells)) {
                    return;
                }

                if (hasMemoryTable) {
                    if (!getCellValue(cells, headerMap.wordIndex) || !getCellValue(cells, headerMap.meaningIndex)) {
                        console.warn("[memory-parser] 빈 셀이 있는 표 행을 무시합니다:", line, "line:", index + 1);
                        return;
                    }

                    result.items.push({
                        id: "item-" + index,
                        front: getCellValue(cells, headerMap.wordIndex),
                        back: getCellValue(cells, headerMap.meaningIndex),
                        prompt: getCellValue(cells, headerMap.promptIndex),
                        illustration: extractIllustrationValue(getCellValue(cells, headerMap.imageIndex))
                    });
                    return;
                }
            }

            match = line.match(/^-\s*(.+?)\s*\|\s*(.+?)\s*$/u);
            if (match) {
                result.items.push({
                    id: "item-" + index,
                    front: match[1],
                    back: match[2],
                    prompt: "",
                    illustration: ""
                });
                return;
            }

            console.warn("[memory-parser] 형식이 잘못된 줄을 무시합니다:", line, "line:", index + 1);
        });

        return result;
    }

    window.MemoryDeckParser = {
        parse: parse
    };
})();
