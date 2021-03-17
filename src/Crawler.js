/* Loads a URL then starts looking for links.
 Emits a full page whenever a new link is found. */
import url from 'url'
import path from 'path'
import jsdom from 'jsdom'
import glob from 'glob-to-regexp'
import snapshot from './snapshot'

export default class Crawler {
  constructor(baseUrl, snapshotDelay, options) {
    this.baseUrl = baseUrl
    const { protocol, host } = url.parse(baseUrl)
    this.protocol = protocol
    this.host = host
    this.paths = [...options.include]
    this.exclude = options.exclude.map((g) => glob(g, { extended: true, globstar: true}))
    this.stripJS = options.stripJS
    this.processed = new Set()
    this.snapshotDelay = snapshotDelay
  }

  crawl(handler) {
    this.handler = handler
    console.log(`🕷   Starting crawling ${this.baseUrl}`)
    return this.snap()
      .then(() => console.log(`🕸   Finished crawling.`))
  }

  async snap() {
    while (this.paths.length) {
      let urlPath = this.paths.unshift();
      urlPath = url.resolve('/', urlPath) // Resolve removes trailing slashes
      if (this.processed.has(urlPath)) {
        continue;
      }

      this.processed.add(urlPath)

      try {
        const window = await snapshot(this.protocol, this.host, urlPath, this.snapshotDelay)

        if (this.stripJS) {
          const strip = new RegExp(this.stripJS)
          Array.from(window.document.querySelectorAll('script')).forEach(script => {
            if (strip.exec(url.parse(script.src).path)) script.remove()
          })
        }

        if (Boolean(window.react_snapshot_state)) {
          const stateJSON = JSON.stringify(window.react_snapshot_state)
          const script = window.document.createElement('script')
          script.innerHTML = `window.react_snapshot_state = JSON.parse('${stateJSON}');`
          window.document.head.appendChild(script)
        }

        const html = jsdom.serializeDocument(window.document)
        this.extractNewLinks(window, urlPath)
        this.handler({ urlPath, html })
        window.close() // Release resources used by jsdom
      } catch (err) {
        throw err;
      }
    }
  }

  extractNewLinks(window, currentPath) {
    const document = window.document
    const tagAttributeMap = {
      'a': 'href',
      'iframe': 'src'
    }

    Object.keys(tagAttributeMap).forEach(tagName => {
      const urlAttribute = tagAttributeMap[tagName]
      Array.from(document.querySelectorAll(`${tagName}[${urlAttribute}]`)).forEach(element => {
        if (element.getAttribute('target') === '_blank') return
        const href = url.parse(element.getAttribute(urlAttribute))
        if (href.protocol || href.host || href.path === null) return;
        const relativePath = url.resolve(currentPath, href.path)
        if (path.extname(relativePath) !== '.html' && path.extname(relativePath) !== '') return;
        if (this.processed.has(relativePath)) return;
        if (this.exclude.filter((regex) => regex.test(relativePath)).length > 0) return
        this.paths.push(relativePath)
      })
    })
  }
}
