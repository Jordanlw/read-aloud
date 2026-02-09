
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
      else return ["js/content/html-doc.js"];
    }
    else if (location.hostname == "drive.google.com") {
      if ($(".drive-viewer-paginated-scrollable").length) return ["js/content/google-drive-doc.js"];
      else return ["js/content/google-drive-preview.js"];
    }
    else if (location.hostname == "onedrive.live.com" && $(".OneUp-pdf--loaded").length) return ["js/content/onedrive-doc.js"];
    else if (/^read\.amazon\./.test(location.hostname)) return ["js/content/kindle-book.js"];
    else if (location.hostname.endsWith(".khanacademy.org")) return ["js/content/khan-academy.js"];
    else if (location.hostname.endsWith("acrobatiq.com")) return ["js/content/html-doc.js", "js/content/acrobatiq.js"];
    else if (location.hostname == "digital.wwnorton.com") return ["js/content/html-doc.js", "js/content/wwnorton.js"];
    else if (location.hostname == "plus.pearson.com") return ["js/content/html-doc.js", "js/content/pearson.js"];
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
    else return ["js/content/html-doc.js"];
  }

  async function getCurrentIndex() {
    if (await getSelectedText()) return -100;
    else return readAloudDoc.getCurrentIndex();
  }

  async function getTexts(index, quietly) {
    if (index < 0) {
      if (index == -100) return (await getSelectedText()).split(paragraphSplitter);
      else return null;
    }
    else {
      return Promise.resolve(readAloudDoc.getTexts(index, quietly))
        .then(function(texts) {
          if (texts && Array.isArray(texts)) {
            if (!quietly) console.log(texts.join("\n\n"));
          }
          return texts;
        })
    }
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
    const ui = createInPageHighlightUi()

    const tick = async () => {
      if (disposed) return
      try {
        const stateInfo = await bgPageInvoke("getPlaybackStateForSender")
        const isVisible = Boolean(stateInfo && stateInfo.activeForSender && ["LOADING", "PLAYING", "PAUSED"].includes(stateInfo.state) && stateInfo.speechInfo)
        if (isVisible) ui.render(stateInfo.speechInfo)
        else ui.hide()
      }
      catch (err) {
        ui.hide()
      }
      finally {
        if (!disposed) setTimeout(tick, 350)
      }
    }

    tick()
    window.addEventListener("pagehide", () => {
      disposed = true
      ui.dispose()
    }, {once: true})
  }

  function createInPageHighlightUi() {
    const id = "readaloud-inpage-highlight"
    const styleId = "readaloud-inpage-highlight-style"
    let host = document.getElementById(id)
    if (!host) {
      host = document.createElement("div")
      host.id = id
      host.style.display = "none"
      document.documentElement.appendChild(host)
    }

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style")
      style.id = styleId
      style.textContent = `
#${id}{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483646;background:rgba(0,0,0,.78);color:#fff;padding:10px 12px;border-radius:8px;font:15px/1.5 Arial,sans-serif;max-height:30vh;overflow:auto;box-shadow:0 4px 18px rgba(0,0,0,.35)}
#${id} .ra-line{cursor:pointer}
#${id} .ra-active{background:#fdd663;color:#000;border-radius:3px}
`
      document.documentElement.appendChild(style)
    }

    function render(speech) {
      if (!speech || !Array.isArray(speech.texts)) return hide()
      host.style.direction = speech.isRTL ? "rtl" : ""
      host.innerHTML = ""
      const pos = speech.position || {index: 0}
      for (let i=0; i<speech.texts.length; i++) {
        const line = document.createElement("div")
        line.className = "ra-line"
        const text = String(speech.texts[i] || "")
        if (i === pos.index && pos.word && pos.word.endIndex > pos.word.startIndex) {
          const a = text.slice(0, pos.word.startIndex)
          const b = text.slice(pos.word.startIndex, pos.word.endIndex)
          const c = text.slice(pos.word.endIndex)
          line.append(document.createTextNode(a))
          const active = document.createElement("span")
          active.className = "ra-active"
          active.textContent = b
          line.append(active)
          line.append(document.createTextNode(c))
        }
        else {
          line.textContent = text
          if (i === pos.index) line.classList.add("ra-active")
        }
        host.appendChild(line)
      }
      host.style.display = "block"
    }

    function hide() {
      host.style.display = "none"
    }

    function dispose() {
      hide()
    }

    return {render, hide, dispose}
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
