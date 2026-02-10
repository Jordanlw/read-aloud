
(function() {
  registerMessageListener("contentScript", {
    getRequireJs: getRequireJs,
    getDocumentInfo: getInfo,
    getCurrentIndex: getCurrentIndex,
    getTexts: getTexts
  })

  function getInfo() {
    return {
      url: location.href,
      title: document.title,
      lang: getLang(),
    }
  }

  function getLang() {
    var lang = document.documentElement.lang || $("html").attr("xml:lang");
    if (lang) lang = lang.split(",",1)[0].replace(/_/g, '-');
    return lang;
  }

  function getRequireJs() {
    if (location.hostname == "docs.google.com") {
      if (/^\/presentation\/d\//.test(location.pathname)) return ["js/content/google-slides.js"];
      else if (/\/document\/d\//.test(location.pathname)) return ["js/content/googleDocsUtil.js", "js/content/google-doc.js"];
      else if ($(".drive-viewer-paginated-scrollable").length) return ["js/content/google-drive-doc.js"];
      else return ["js/content/text-range-resolver.js", "js/content/html-doc.js"];
    }
    else if (location.hostname == "drive.google.com") {
      if ($(".drive-viewer-paginated-scrollable").length) return ["js/content/google-drive-doc.js"];
      else return ["js/content/google-drive-preview.js"];
    }
    else if (location.hostname == "onedrive.live.com" && $(".OneUp-pdf--loaded").length) return ["js/content/onedrive-doc.js"];
    else if (/^read\.amazon\./.test(location.hostname)) return ["js/content/kindle-book.js"];
    else if (location.hostname.endsWith(".khanacademy.org")) return ["js/content/khan-academy.js"];
    else if (location.hostname.endsWith("acrobatiq.com")) return ["js/content/text-range-resolver.js", "js/content/html-doc.js", "js/content/acrobatiq.js"];
    else if (location.hostname == "digital.wwnorton.com") return ["js/content/text-range-resolver.js", "js/content/html-doc.js", "js/content/wwnorton.js"];
    else if (location.hostname == "plus.pearson.com") return ["js/content/text-range-resolver.js", "js/content/html-doc.js", "js/content/pearson.js"];
    else if (location.hostname == "www.ixl.com") return ["js/content/ixl.js"];
    else if (location.hostname == "www.webnovel.com" && location.pathname.startsWith("/book/")) return ["js/content/webnovel.js"];
    else if (location.hostname == "archiveofourown.org") return ["js/content/archiveofourown.js"];
    else if (location.hostname == "chat.openai.com") return ["js/content/chatgpt.js"];
    else if (location.pathname.match(/readaloud\.html$/)
      || location.pathname.match(/\.pdf$/)
      || $("embed[type='application/pdf']").length
      || $("iframe[src*='.pdf']").length) return ["js/content/pdf-doc.js"];
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)
        && location.port === "1122"
        && location.protocol === "http:"
        && location.pathname === "/bookshelf/index.html") return  ["js/content/yd-app-web.js"];
    else return ["js/content/text-range-resolver.js", "js/content/html-doc.js"];
  }

  async function getCurrentIndex() {
    if (await getSelectedText()) return -100;
    else return readAloudDoc.getCurrentIndex();
  }

  const sourceChunkStore = new Map()

  async function getTexts(index, quietly) {
    if (index < 0) {
      if (index == -100) return (await getSelectedText()).split(paragraphSplitter);
      else return null;
    }
    else {
      return Promise.resolve(readAloudDoc.getTexts(index, quietly))
        .then(function(result) {
          var texts = normalizeTexts(result)
          if (texts && Array.isArray(texts)) {
            if (!quietly) console.log(texts.join("\n\n"));
          }
          return texts;
        })
    }
  }

  function normalizeTexts(result) {
    if (!result || !Array.isArray(result)) return result
    if (!result.length || typeof result[0] == "string") return result
    var chunks = result.filter(Boolean)
    var texts = chunks.map(chunk => chunk.text)
    sourceChunkStore.set(getTextsKey(texts), chunks)
    return texts
  }

  function getTextsKey(texts) {
    return (texts || []).join("\n\u241E\n")
  }

  function getSelectedText() {
    if (readAloudDoc.getSelectedText) return readAloudDoc.getSelectedText()
    return window.getSelection().toString().trim();
  }


  getSettings()
    .then(settings => {
      if (settings.fixBtSilenceGap)
        setInterval(updateSilenceTrack.bind(null, Math.random()), 5000)
    })

  async function updateSilenceTrack(providerId) {
    if (!audioCanPlay()) return;
    const silenceTrack = getSilenceTrack()
    try {
      const should = await sendToPlayer({method: "shouldPlaySilence", args: [providerId]})
      if (should) silenceTrack.start()
      else silenceTrack.stop()
    }
    catch (err) {
      silenceTrack.stop()
    }
  }

  function audioCanPlay() {
    return navigator.userActivation && navigator.userActivation.hasBeenActive
  }

  async function sendToPlayer(message) {
    message.dest = "player"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }

  startInPageHighlighting()

  function startInPageHighlighting() {
    let disposed = false
    const highlighter = createInPageWordHighlighter()

    const tick = async () => {
      if (disposed) return
      try {
        const stateInfo = await bgPageInvoke("getPlaybackStateForSender")
        const shouldHighlight = Boolean(stateInfo && stateInfo.activeForSender && stateInfo.state == "PLAYING" && stateInfo.speechInfo)
        if (shouldHighlight) highlighter.render(stateInfo.speechInfo)
        else highlighter.clear()
      }
      catch (err) {
        highlighter.clear()
      }
      finally {
        if (!disposed) setTimeout(tick, 350)
      }
    }

    tick()
    window.addEventListener("pagehide", () => {
      disposed = true
      highlighter.dispose()
    }, {once: true})
  }

  function createInPageWordHighlighter() {
    const styleId = "readaloud-word-highlight-style"
    const className = "readaloud-word-highlight"
    const staleHighlightGraceMs = 1200
    let currentHighlight = null
    let lastMatchStart = 0
    let lastPositionIndex = null
    let unresolvedSince = 0
    let lastResolvedPoint = null
    let lastResolvedPositionIndex = null

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style")
      style.id = styleId
      style.textContent = `
.${className}{background:#fdd663;color:inherit;border-radius:2px}
`
      document.documentElement.appendChild(style)
    }

    function render(speech) {
      if (!speech || !Array.isArray(speech.texts)) return
      const pos = speech.position || {index: 0}
      const positionIndex = Number(pos.index) || 0

      if (isSignificantIndexJump(positionIndex, lastPositionIndex)) {
        lastMatchStart = 0
        lastResolvedPoint = null
        lastResolvedPositionIndex = null
      }

      const lineText = String(speech.texts[positionIndex] || "")
      if (!lineText) return

      const section = getHighlightSection(pos, lineText)
      if (!section) return

      const segment = resolveSpeechSectionRange(lineText, section.startIndex, section.endIndex, {
        preferredStart: lastMatchStart,
        positionIndex: positionIndex,
        previousPositionIndex: lastResolvedPositionIndex,
        previousPoint: lastResolvedPoint,
      })

      if (!segment) {
        if (!unresolvedSince) unresolvedSince = Date.now()
        if (positionIndex != lastPositionIndex || Date.now() - unresolvedSince > staleHighlightGraceMs) clear()
        lastPositionIndex = positionIndex
        return
      }

      unresolvedSince = 0
      clear()
      lastMatchStart = segment.matchStart
      lastResolvedPoint = segment.start
      lastResolvedPositionIndex = positionIndex
      lastPositionIndex = positionIndex

      const range = document.createRange()
      range.setStart(segment.start.node, segment.start.offset)
      range.setEnd(segment.end.node, segment.end.offset)

      const highlight = document.createElement("span")
      highlight.className = className
      highlight.appendChild(range.extractContents())
      range.insertNode(highlight)
      currentHighlight = highlight
    }

    function clear() {
      if (!currentHighlight || !currentHighlight.parentNode) {
        currentHighlight = null
        unresolvedSince = 0
        return
      }
      const parent = currentHighlight.parentNode
      while (currentHighlight.firstChild) parent.insertBefore(currentHighlight.firstChild, currentHighlight)
      parent.removeChild(currentHighlight)
      parent.normalize()
      currentHighlight = null
      unresolvedSince = 0
    }

    function dispose() {
      clear()
    }

    return {render, clear, dispose}
  }

  function isSignificantIndexJump(index, previousIndex) {
    if (typeof previousIndex != "number") return false
    return Math.abs(index - previousIndex) >= 3
  }

  function getHighlightSection(position, lineText) {
    const candidate = position.word || position.sentence || position.paragraph
    if (candidate && candidate.endIndex > candidate.startIndex) return candidate
    if (!lineText) return null
    return {startIndex: 0, endIndex: lineText.length}
  }

  function resolveSpeechSectionRange(lineText, sectionStart, sectionEnd, options) {
    options = options || {}
    const preferredStart = Number(options.preferredStart) || 0
    const target = normalizeForMatch(lineText)
    if (!target.text) return null

    const sectionKey = [
      Number.isFinite(options.positionIndex) ? options.positionIndex : "na",
      sectionStart,
      sectionEnd,
    ].join(":")
    const docText = collectDocumentTextForMatch({sectionKey: sectionKey})
    if (!docText.text) return null

    const localAnchors = [preferredStart]
    const anchorFromNode = findMapIndexForNodeContext(docText.map, options.previousPoint)
    if (anchorFromNode >= 0) localAnchors.unshift(anchorFromNode)
    if (typeof options.positionIndex == "number" && typeof options.previousPositionIndex == "number") {
      const estimatedShift = (options.positionIndex - options.previousPositionIndex) * Math.max(1, target.text.length)
      localAnchors.push(preferredStart + estimatedShift)
    }

    let segment = resolveSegmentInDocumentText(docText, target.text, lineText, sectionStart, sectionEnd, localAnchors, preferredStart)
    if (segment) {
      noteRootMatchSuccess(options.positionIndex, sectionKey, docText.root)
      return segment
    }

    const failureCount = noteRootMatchFailure(options.positionIndex)
    console.debug("[ReadAloud][highlight] Match unresolved", {
      positionIndex: options.positionIndex,
      sectionKey: sectionKey,
      rootMode: docText.root && docText.root.mode,
      failureCount: failureCount,
    })

    const shouldRetryWithBody = failureCount >= 2 && docText.root && docText.root.mode != "body"
    if (!shouldRetryWithBody) return null

    const bodyDocText = collectDocumentTextForMatch({forceBody: true, sectionKey: sectionKey})
    if (!bodyDocText.text) return null
    console.debug("[ReadAloud][highlight] Retrying match with document.body fallback", {
      positionIndex: options.positionIndex,
      sectionKey: sectionKey,
    })

    segment = resolveSegmentInDocumentText(bodyDocText, target.text, lineText, sectionStart, sectionEnd, localAnchors, preferredStart)
    if (!segment) return null

    noteRootMatchSuccess(options.positionIndex, sectionKey, bodyDocText.root)
    return segment
  }

  const rootMatchState = {
    failuresByPosition: Object.create(null),
    lastSuccessfulRoot: null,
    lastSuccessfulSectionKey: null,
  }

  function noteRootMatchFailure(positionIndex) {
    const key = Number.isFinite(positionIndex) ? positionIndex : "na"
    const failures = (rootMatchState.failuresByPosition[key] || 0) + 1
    rootMatchState.failuresByPosition[key] = failures
    return failures
  }

  function noteRootMatchSuccess(positionIndex, sectionKey, rootInfo) {
    const key = Number.isFinite(positionIndex) ? positionIndex : "na"
    rootMatchState.failuresByPosition[key] = 0
    if (rootInfo && rootInfo.node && rootInfo.node.isConnected) {
      rootMatchState.lastSuccessfulRoot = rootInfo
      rootMatchState.lastSuccessfulSectionKey = sectionKey
    }
    console.debug("[ReadAloud][highlight] Match resolved", {
      positionIndex: positionIndex,
      sectionKey: sectionKey,
      rootMode: rootInfo && rootInfo.mode,
    })
  }

  function resolveSegmentInDocumentText(docText, targetText, lineText, sectionStart, sectionEnd, localAnchors, preferredStart) {
    const localMatch = findBestMatchNearAnchors(docText.text, targetText, localAnchors)
    const matches = localMatch != null
      ? [localMatch]
      : collectAllMatchIndexes(docText.text, targetText)
    if (!matches.length) return null

    const matchStart = pickBestMatch(matches, preferredStart)
    const startInTarget = rawOffsetToNormalizedOffset(lineText, sectionStart)
    const endInTarget = rawOffsetToNormalizedOffset(lineText, sectionEnd)
    const startIndex = matchStart + startInTarget
    const endIndex = matchStart + endInTarget
    if (startIndex >= endIndex || !docText.map[startIndex] || !docText.map[endIndex-1]) return null

    return {
      matchStart: matchStart,
      start: docText.map[startIndex],
      end: {
        node: docText.map[endIndex-1].node,
        offset: docText.map[endIndex-1].offset + 1,
      },
    }
  }

  function collectAllMatchIndexes(haystack, needle) {
    const matches = []
    let searchFrom = 0
    while (true) {
      const index = haystack.indexOf(needle, searchFrom)
      if (index < 0) break
      matches.push(index)
      searchFrom = index + 1
    }
    return matches
  }

  function findBestMatchNearAnchors(haystack, needle, anchors) {
    const radius = 3000
    let bestMatch = null
    let bestDistance = Infinity
    for (const anchor of anchors || []) {
      if (!Number.isFinite(anchor)) continue
      const start = Math.max(0, Math.floor(anchor) - radius)
      const end = Math.min(haystack.length, Math.floor(anchor) + radius)
      let index = haystack.indexOf(needle, start)
      while (index >= 0 && index <= end) {
        const distance = Math.abs(index - anchor)
        if (distance < bestDistance) {
          bestDistance = distance
          bestMatch = index
        }
        index = haystack.indexOf(needle, index + 1)
      }
    }
    return bestMatch
  }

  function findMapIndexForNodeContext(map, point) {
    if (!point || !point.node) return -1
    let fallback = -1
    for (let i=0; i<map.length; i++) {
      if (map[i].node == point.node) {
        if (fallback < 0) fallback = i
        if (map[i].offset >= point.offset) return i
      }
    }
    return fallback
  }

  function pickBestMatch(matches, preferredStart) {
    let best = matches[0]
    let bestDistance = Math.abs(best - preferredStart)
    for (let i=1; i<matches.length; i++) {
      const distance = Math.abs(matches[i] - preferredStart)
      if (distance < bestDistance) {
        best = matches[i]
        bestDistance = distance
      }
    }
    return best
  }

  function normalizeForMatch(text) {
    const out = []
    let prevWhitespace = true
    for (let i=0; i<text.length; i++) {
      const ch = text[i]
      if (/\s/.test(ch)) {
        if (!prevWhitespace) {
          out.push(" ")
          prevWhitespace = true
        }
      }
      else {
        out.push(ch)
        prevWhitespace = false
      }
    }
    if (out.length && out[out.length-1] == " ") out.pop()
    return {text: out.join("")}
  }

  function rawOffsetToNormalizedOffset(text, rawOffset) {
    const cappedOffset = Math.max(0, Math.min(rawOffset, text.length))
    let normalizedOffset = 0
    let prevWhitespace = true
    for (let i=0; i<cappedOffset; i++) {
      if (/\s/.test(text[i])) {
        if (!prevWhitespace) {
          normalizedOffset++
          prevWhitespace = true
        }
      }
      else {
        normalizedOffset++
        prevWhitespace = false
      }
    }
    return normalizedOffset
  }

  function collectDocumentTextForMatch(options) {
    options = options || {}
    const preferredRoot = document.querySelector("article, main, [role='main']")
    const shouldReuseCachedRoot = !options.forceBody
      && options.sectionKey
      && options.sectionKey == rootMatchState.lastSuccessfulSectionKey
      && rootMatchState.lastSuccessfulRoot
      && rootMatchState.lastSuccessfulRoot.node
      && rootMatchState.lastSuccessfulRoot.node.isConnected

    const rootInfo = options.forceBody
      ? {node: document.body, mode: "body", reason: "forced-body-fallback"}
      : shouldReuseCachedRoot
        ? {node: rootMatchState.lastSuccessfulRoot.node, mode: "cached", reason: "reuse-last-success"}
        : preferredRoot
          ? {node: preferredRoot, mode: "semantic", reason: "preferred-semantic-root"}
          : {node: document.body, mode: "body", reason: "semantic-root-missing"}
    const root = rootInfo.node || document.body

    console.debug("[ReadAloud][highlight] collectDocumentTextForMatch root selected", {
      sectionKey: options.sectionKey,
      rootMode: rootInfo.mode,
      reason: rootInfo.reason,
      tagName: root && root.tagName,
    })

    const ephemeralSelector = [
      "[aria-live]",
      "[role='status']",
      "[role='alert']",
      ".ad",
      ".ads",
      ".advertisement",
      "[id*='ad-']",
      "[class*='countdown']",
      "[class*='counter']",
    ].join(", ")
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        if (!node.parentElement) return NodeFilter.FILTER_REJECT
        if (node.parentElement.closest("script, style, noscript, textarea, input, select, option, button, .readaloud-word-highlight")) return NodeFilter.FILTER_REJECT
        if (node.parentElement.closest(ephemeralSelector)) return NodeFilter.FILTER_REJECT
        const style = window.getComputedStyle(node.parentElement)
        if (style.display == "none" || style.visibility == "hidden") return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })

    const text = []
    const map = []
    let prevWhitespace = true
    while (walker.nextNode()) {
      const node = walker.currentNode
      const value = node.nodeValue
      for (let i=0; i<value.length; i++) {
        const ch = value[i]
        if (/\s/.test(ch)) {
          if (!prevWhitespace) {
            text.push(" ")
            map.push({node: node, offset: i})
            prevWhitespace = true
          }
        }
        else {
          text.push(ch)
          map.push({node: node, offset: i})
          prevWhitespace = false
        }
      }
    }
    if (text.length && text[text.length-1] == " ") {
      text.pop()
      map.pop()
    }
    return {text: text.join(""), map: map, root: rootInfo}
  }
})()


//helpers --------------------------

var paragraphSplitter = /(?:\s*\r?\n\s*){2,}/;

function getInnerText(elem) {
  var text = elem.innerText;
  return text ? text.trim() : "";
}

function isNotEmpty(text) {
  return text;
}

function fixParagraphs(texts) {
  var out = [];
  var para = "";
  for (var i=0; i<texts.length; i++) {
    if (!texts[i]) {
      if (para) {
        out.push(para);
        para = "";
      }
      continue;
    }
    if (para) {
      if (/[-\u2013\u2014]$/.test(para)) para = para.substr(0, para.length-1);
      else para += " ";
    }
    para += texts[i].replace(/[-\u2013\u2014]\r?\n/g, "");
    if (texts[i].match(/[.!?:)"'\u2019\u201d]$/)) {
      out.push(para);
      para = "";
    }
  }
  if (para) out.push(para);
  return out;
}

function tryGetTexts(getTexts, millis) {
  return waitMillis(500)
    .then(getTexts)
    .then(function(texts) {
      if (texts && !texts.length && millis-500 > 0) return tryGetTexts(getTexts, millis-500);
      else return texts;
    })
}

function loadPageScript(url) {
  if (!$("head").length) $("<head>").prependTo("html");
  $.ajax({
    dataType: "script",
    cache: true,
    url: url
  });
}

function simulateMouseEvent(element, eventName, coordX, coordY) {
  element.dispatchEvent(new MouseEvent(eventName, {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: coordX,
    clientY: coordY,
    button: 0
  }));
}

function simulateClick(elementToClick) {
  var box = elementToClick.getBoundingClientRect(),
      coordX = box.left + (box.right - box.left) / 2,
      coordY = box.top + (box.bottom - box.top) / 2;
  simulateMouseEvent (elementToClick, "mousedown", coordX, coordY);
  simulateMouseEvent (elementToClick, "mouseup", coordX, coordY);
  simulateMouseEvent (elementToClick, "click", coordX, coordY);
}

const getMath = (function() {
  let promise = Promise.resolve(null)
  return () => promise = promise.then(math => math || makeMath())
})();

async function makeMath() {
  const getXmlFromMathEl = function(mathEl) {
    const clone = mathEl.cloneNode(true)
    $("annotation, annotation-xml", clone).remove()
    removeAllAttrs(clone, true)
    return clone.outerHTML
  }

  //determine the mml markup
  const math =
    when(document.querySelector(".MathJax, .MathJax_Preview"), {
      selector: ".MathJax[data-mathml]",
      getXML(el) {
        const mathEl = el.querySelector("math")
        return mathEl ? getXmlFromMathEl(mathEl) : el.getAttribute("data-mathml")
      },
    })
    .when(() => document.querySelector("math"), {
      selector: "math",
      getXML: getXmlFromMathEl,
    })
    .else(null)

  if (!math) return null
  const elems = $(math.selector).get()
  if (!elems.length) return null

  //create speech surrogates
  try {
    const xmls = elems.map(math.getXML)
    const texts = await ajaxPost(config.serviceUrl + "/read-aloud/mathml", xmls, "json").then(JSON.parse)
    elems.forEach((el, i) => $("<span>").addClass("readaloud-mathml").text(texts[i] || "math expression").insertBefore(el))
  }
  catch (err) {
    console.error(err)
    return {
      show() {},
      hide() {}
    }
  }

  //return functions to toggle between mml and speech
  return {
    show() {
      for (const el of elems) el.style.setProperty("display", "none", "important")
      $(".readaloud-mathml").show()
    },
    hide() {
      $(elems).css("display", "")
      $(".readaloud-mathml").hide()
    }
  }
}
