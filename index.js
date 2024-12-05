// COMMENT OUT FOR DEBUG
import { getContext } from "../../../extensions.js";
const context = getContext();

// UNCOMMENT FOR DEBUG
//const context = context || window.SillyTavern.getContext();

let highlightTimer = null;
let highlightInterval = null;
let lastHighlight = Date.now();

function injectStyle(css) {
    document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
}
function findTextCoordinates(element, searchText) {
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

    let currentNode;
    const coordinates = [];

    while (currentNode = walker.nextNode()) {
        const textContent = currentNode.textContent;
        let startIndex = 0;
        let index;

        // Search for all occurrences of searchText in the current text node
        while ((index = textContent.indexOf(searchText, startIndex)) !== -1) {
            range.setStart(currentNode, index);
            range.setEnd(currentNode, index + searchText.length);

            const rect = range.getBoundingClientRect();

            // Push both starting and ending positions
            coordinates.push({
                start: { x: rect.left, y: rect.top },
                end: { x: rect.right, y: rect.bottom }
            });

            // Move the start index forward to search for the next occurrence
            startIndex = index + searchText.length;
        }
    }

    if (coordinates.length > 0) {
        return coordinates;
    } else {
        throw new Error(`Text "${searchText}" not found.`);
    }
}
injectStyle(`
        .bo-highlight {
            background-color: var(--SmartThemeEmColor);
            color: var(--SmartThemeBlurTintColor);
            position: fixed;
            z-index: 100000000;
            /*pointer-events: none; */
            opacity: 0.7;
        }
        .bo-ngram {
            background-color: var(--SmartThemeEmColor);
            color: var(--SmartThemeBlurTintColor);
            padding: 2px;
            border-radius: 2px;
            display: inline-block;
            padding: 2px 2px !important;
            margin: 2px;
            filter: invert(0.1);
        }
        .bo-ngram.click:hover {
            cursor: pointer;
            opacity: 0.8;
        }
        
    `)

const reg = new RegExp(/["'--–—\[\]]/, "g")
function cleanWord(word) {
    if (!word) return
    return word.replaceAll(reg, "").trim()
}
let popup = null

function calculateProximity(text, maxWords = 2, maxDistance = 3) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
    const proximityMap = new Map();

    for (let i = 0; i < words.length; i++) {
        for (let j = 1; j <= maxDistance; j++) {
            if (i + j >= words.length) break;

            for (let k = 2; k <= maxWords; k++) {
                if (i + j + k - 1 >= words.length) break;
                const wordGroup = words.slice(i, i + k).sort().join(' ');

                if (!proximityMap.has(wordGroup)) {
                    proximityMap.set(wordGroup, 0);
                }
                proximityMap.set(wordGroup, proximityMap.get(wordGroup) + 1);
            }
        }
    }

    const sortedProximity = Array.from(proximityMap.entries())
        .sort((a, b) => b[1] - a[1])
        .filter(entry => entry[1] > 1);

    return sortedProximity.map(([wordGroup, score]) => ({
        words: wordGroup.split(" "),
        score
    }));
}

function tokenize(text) {
    const tokens = [];
    let currentToken = '';
    let isSpace = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (/\s/.test(char)) {
            if (!isSpace && currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
            isSpace = true;
            currentToken += char;
        } else {
            if (isSpace && currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
            isSpace = false;
            currentToken += char;
        }
    }

    if (currentToken) {
        tokens.push(currentToken);
    }

    return tokens;
}


async function calculate(params = {}) {
    let {
        lastN = 50,
        includeUser = false,
        includeSystem = false,
        cutoff = 2,
        ignoreLast = false,
    } = params;

    let chatTrunc = parseInt(document.querySelector("#chat_truncation_counter")?.value || "100", 10)
    if (chatTrunc == 0) {
        chatTrunc = 10000000;
    }

    let chatFiltered = context.chat.slice(-chatTrunc).filter(m => (!m.is_user || includeUser) && (includeSystem || !m.is_system));
    if (ignoreLast) {
        chatFiltered = chatFiltered.slice(0, -1)
    }

    const text = chatFiltered.map(m => m.mes).slice(-lastN).join("\n")

    let words = [];
    words = text.split(" ");

    function getNGrams(_ = "", n, top) {
        const nGrams = {};

        // Generate n-grams
        for (let i = 0; i <= words.length - n; i++) {
            const nGram = words.slice(i, i + n).join(' ');
            nGrams[nGram] = (nGrams[nGram] || 0) + 1;
        }

        let filteredNGrams = Object.entries(nGrams).filter(([, count]) => count >= cutoff);

        // Merge overlapping n-grams
        const mergedNGrams = [];
        const seen = new Set();

        //// Sort merged n-grams by frequency in descending order
        for (let i = 0; i < filteredNGrams.length; i++) {
            const [nGram, count] = filteredNGrams[i];
            if (seen.has(nGram)) continue;

            let extendedNGram = nGram;
            let extendedCount = count;
            seen.add(nGram);

            for (let j = i + 1; j < filteredNGrams.length; j++) {
                const [nextNGram, nextCount] = filteredNGrams[j];
                const tokenizedNextgram = nextNGram.split(" ");
                if (extendedNGram.endsWith(tokenizedNextgram.slice(0, n - 1).join(' '))) {
                    extendedNGram = extendedNGram + " " + tokenizedNextgram.slice(n - 1).join(' ');
                    extendedCount = Math.min(extendedCount, nextCount);
                    seen.add(nextNGram);
                }
            }

            mergedNGrams.push([extendedNGram, extendedCount]);
        }

        // Sort merged n-grams by frequency in descending order
        mergedNGrams.sort((a, b) => b[1] - a[1]);
        filteredNGrams.sort((a, b) => b[1] - a[1]);

        // Output top n merged n-grams
        return [filteredNGrams.slice(0, top), mergedNGrams.slice(0, top)]
    }

    //const chat = [...context.chat];
    //chat.reverse();
    //function renderSequenceHighlight(sequence) {
    //    [...document.querySelectorAll(".bo-highlight")].forEach((el) => {
    //        el.outerHTML = "";
    //    });
    //
    //    for (const [text = "", rep = 0] of sequence) {
    //        chat.forEach((ch, idx) => {
    //            if (ch.mes.includes(text)) {
    //                const messId = chat.length - idx - 1;
    //                const mes = document.querySelector(`.mes[mesid="${messId}"]`);
    //                try {
    //                    for (const { start, end } of findTextCoordinates(mes, text)) {
    //                        const highlight = document.createElement("div");
    //                        highlight.title = `Repetitions: ${rep}`;
    //                        highlight.className = "bo-highlight";
    //                        highlight.style.top = `${start.y}px`;
    //                        highlight.style.left = `${start.x}px`;
    //                        highlight.style.width = `${end.x - start.x}px`;
    //                        highlight.style.height = "20px";
    //
    //                        document.body.appendChild(highlight);
    //                    }
    //                } catch (err) {
    //                    //console.warn(err)
    //                    //
    //                }
    //            }
    //        });
    //    }
    //}

    // TODO: floating highlight
    //document.addEventListener("wheel", () => {
    //    const now = Date.now();
    //
    //    if (now - lastHighlight < 100) {
    //        clearTimeout(highlightTimer);
    //        highlightTimer = setTimeout(() => {
    //            requestAnimationFrame(() => {
    //                renderSequenceHighlight(sequence4[0]);
    //                lastHighlight = now;
    //            });
    //        }, 32);
    //        return
    //    }
    //
    //    renderSequenceHighlight(sequence4[0]);
    //    lastHighlight = now;
    //})

    const sequence1 = getNGrams(text, 10, 40);
    const sequence2 = getNGrams(text, 5, 40);
    const sequence3 = getNGrams(text, 4, 40);
    const sequence4 = getNGrams(text, 3, 40);
    const sequence5 = getNGrams(text, 2, 40);
    const sequence6 = getNGrams(text, 1, 80);

    let output = ``;

    output += `<strong>Click on sequence to jump to the last occurence and edit it.</strong>`
    output += '<pre class="bo-ngrams" style="text-align: left; padding: 10px; white-space: break-spaces;">'

    output += `<h3>Longer sequences</h3>`
    output += "<br/>"
    output += sequence1[1].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"

    output += `<h3>Long sequences</h3>`
    output += "<br/>"
    output += sequence2[1].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"

    output += `<h3>Short sequences</h3>`
    output += "<br/>"
    output += sequence3[1].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"

    output += `<h3>Shorter sequences</h3>`
    output += "<br/>"
    output += sequence4[0].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"

    output += `<h3>Very short sequences</h3>`
    output += "<br/>"
    output += sequence5[0].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"

    output += `<h3>Words</h3>`
    output += "<br/>"
    output += sequence6[0].map(([text, rep]) => `<strong class="bo-ngram click">${text}</strong>: ${rep}`).join("\n")
    output += "<br/>"


    output += `<h3>Words that are often grouped together (with score)</h3>`
    output += "<br/>"

    output += calculateProximity(text, 3, 3).slice(0, 60).map((f) => `<strong class="bo-ngram">${f.words.join(',')}</strong>: ${f.score}`).join("\n")

    output += "</pre>"

    popup = new context.Popup(output, 1, "", { wider: true, large: true, allowVerticalScrolling: true })
    popup.show();
}

const SlashCommand = context.SlashCommand;
const SlashCommandParser = context.SlashCommandParser;
const SlashCommandArgument = context.SlashCommandArgument;
const SlashCommandNamedArgument = context.SlashCommandNamedArgument;

function selectTextInTextarea(textarea, searchText) {
    const text = textarea.value;
    const startIndex = text.indexOf(searchText);

    if (startIndex !== -1) { // If the searchText is found
        textarea.focus();
        textarea.setSelectionRange(startIndex, startIndex + searchText.length);
    } else {
        console.log("Text not found in the textarea.");
    }
}
document.addEventListener("click", (e) => {
    if (!e.target.className.includes("ngram")) {
        return
    }

    e.target.innerText;
    const chat = [...context.chat];
    chat.reverse();

    const ref = e.target.innerText;

    let messId = chat.findIndex((ch) => ch.mes.includes(ref));
    if (messId >= 0) {
        messId = chat.length - messId - 1;
        const mes = document.querySelector(`.mes[mesid="${messId}"]`);
        if (mes) {
            popup.complete("");
            mes.scrollIntoView()
            mes.querySelector(".mes_edit")?.click?.();
            setTimeout(() => {
                const textarea = mes.querySelector(".mes_text textarea#curEditTextarea");
                textarea.scrollIntoView({ block: "center" })
                textarea.focus()
                requestAnimationFrame(() => {
                    selectTextInTextarea(textarea, ref)
                    setTimeout(() => {
                        selectTextInTextarea(textarea, ref)
                    }, 100)
                })
            }, 200)
        }
    }
})

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'inrep',
    callback: (namedArgs, unnamedArgs) => {
        const lastN = parseInt(namedArgs.n || 100, 10);
        const includeUser = namedArgs.include_user === "on";
        const cutoff = Math.max(parseInt(namedArgs.cutoff || 2, 10));
        const ignoreLast = namedArgs.ignore_last === "on";
        const save = namedArgs.save === "on";

        const slashCommandInput = [
            "/inrep",
            (namedArgs.n != null ? "n=" + lastN : ""),
            (namedArgs.include_user != null ? "include_user=" + (includeUser ? "on" : "off") : ""),
            (namedArgs.cutoff != null ? "cutoff=" + cutoff : ""),
            (namedArgs.ignore_last != null ? "ignore_last=" + (ignoreLast ? "on" : "off") : ""),
            (namedArgs.save != null ? "save=" + (save ? "on" : "off") : ""),
        ].filter(c => !!c).join(" ");

        if (namedArgs.save && document.querySelector("#send_textarea")) {
            document.querySelector("#send_textarea").value = slashCommandInput;
        }
        calculate({ lastN, includeUser, cutoff, ignoreLast })
    },
    aliases: ['inrep'],
    returns: 'Repetition Inspector Window',
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'n',
            description: 'Only process the last N messages.',
            typeList: "number",
            defaultValue: "100",
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'ignore_last',
            description: 'Ignore last message',
            typeList: "bool",
            defaultValue: "off",
            enumList: ["on", "off"],
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'cutoff',
            description: 'Filters out repetitions that are fewer than this specified number. (Minimum: 2)',
            typeList: "number",
            defaultValue: "2",
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'include_user',
            description: 'Include user message',
            typeList: "bool",
            defaultValue: "off",
            enumList: ["on", "off"],
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'save',
            description: 'Preserve slash command between executions',
            typeList: "bool",
            defaultValue: "off",
            enumList: ["on", "off"],
        }),
    ],
    unnamedArgumentList: [
        //SlashCommandArgument.fromProps({
        //    description: 'the text to repeat',
        //    typeList: "bool",
        //    isRequired: false,
        //}),
    ],
    helpString: `
        <div>
            Inspect Repetitions.
            Inspect the specified portion of bot replies in order to find repeated patterns.

            <h3>NOTE: Maximum messages are limited by \`Msg. to Load\` paramenter in User Settings.</h3>
        </div>
        <div>
            <strong>Example:</strong>
            <ul>
                <li>
                    <pre><code class="language-stscript">/inrep</code></pre>
                </li>
                <li>
                    <pre><code class="language-stscript">/inrep n=50</code></pre>
                </li>
                <li>
                    <pre><code class="language-stscript">/inrep include_user=on</code></pre>
                </li>
            </ul>
        </div>
    `,
}));
