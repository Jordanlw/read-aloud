function createTextRangeResolver(chunks) {
  const chunkList = Array.isArray(chunks) ? chunks : []

  this.resolveWordRange = function(chunkIndex, wordStart, wordEnd) {
    return resolveOffsetRange(chunkIndex, wordStart, wordEnd)
  }

  this.resolveChunkRange = function(chunkIndex) {
    const chunk = chunkList[chunkIndex]
    if (!chunk) return null
    return resolveOffsetRange(chunkIndex, 0, (chunk.text || "").length)
  }

  this.resolveNearestBlockRange = function(chunkIndex) {
    const chunk = chunkList[chunkIndex]
    const elem = chunk && chunk.source && chunk.source.element
    if (!elem) return null
    const textNode = findFirstTextNode(elem)
    if (textNode) {
      const range = document.createRange()
      range.setStart(textNode, 0)
      range.setEnd(textNode, textNode.nodeValue.length)
      return range
    }
    if (elem.firstChild) {
      const range = document.createRange()
      range.selectNodeContents(elem)
      return range
    }
    return null
  }

  function resolveOffsetRange(chunkIndex, startOffset, endOffset) {
    const chunk = chunkList[chunkIndex]
    if (!chunk || !chunk.source || !Array.isArray(chunk.source.textNodes)) return null
    const totalLength = (chunk.text || "").length
    const targetStart = clamp(startOffset, 0, totalLength)
    const targetEnd = clamp(endOffset, targetStart, totalLength)
    const segments = buildSegments(chunk.source.textNodes)
    if (!segments.length) return null
    const startPos = findNodePosition(segments, targetStart)
    const endPos = findNodePosition(segments, targetEnd)
    if (!startPos || !endPos) return null
    const range = document.createRange()
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)
    return range
  }

  function buildSegments(textNodes) {
    const out = []
    let cursor = 0
    for (const node of textNodes) {
      if (!node || node.nodeType !== 3 || !node.nodeValue) continue
      const projection = projectRawText(node.nodeValue)
      if (!projection.normalized.length) continue
      out.push({
        node,
        start: cursor,
        end: cursor + projection.normalized.length,
        normToRaw: projection.normToRaw,
      })
      cursor += projection.normalized.length
    }
    return out
  }

  function findNodePosition(segments, chunkOffset) {
    if (!segments.length) return null
    if (chunkOffset === segments[segments.length - 1].end) {
      const last = segments[segments.length - 1]
      return {node: last.node, offset: last.node.nodeValue.length}
    }
    const seg = segments.find(s => chunkOffset >= s.start && chunkOffset < s.end)
    if (!seg) return null
    const idx = chunkOffset - seg.start
    const rawOffset = seg.normToRaw[idx] != null ? seg.normToRaw[idx] : seg.node.nodeValue.length
    return {node: seg.node, offset: rawOffset}
  }

  function projectRawText(raw) {
    let normalized = ""
    const normToRaw = []
    let prevSpace = true
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (/\s/.test(ch)) {
        if (!prevSpace) {
          normalized += " "
          normToRaw.push(i)
          prevSpace = true
        }
      }
      else {
        normalized += ch
        normToRaw.push(i)
        prevSpace = false
      }
    }
    normalized = normalized.trim()
    if (!normalized) return {normalized: "", normToRaw: []}
    let lead = 0
    while (lead < normToRaw.length && /\s/.test(raw[normToRaw[lead]])) lead++
    return {normalized, normToRaw: normToRaw.slice(lead)}
  }

  function findFirstTextNode(elem) {
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) return node
    }
    return null
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
  }
}
