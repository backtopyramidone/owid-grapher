import * as fs from "fs-extra" // todo: this should not be here.
import urljoin from "url-join"
import * as path from "path"
import { ENV } from "../settings/serverSettings"

const WEBPACK_DEV_URL = process.env.WEBPACK_DEV_URL ?? "localhost"
const WEBPACK_OUTPUT_PATH =
    process.env.WEBPACK_OUTPUT_PATH ?? path.join(__dirname + "/../", "webpack")

let manifest: { [key: string]: string }
export const webpackUrl = (
    assetName: string,
    baseUrl = "",
    isProduction = ENV === "production"
) => {
       return urljoin(WEBPACK_DEV_URL, assetName)
}

export const bakeEmbedSnippet = (
    baseUrl: string
) => `const embedSnippet = () => {
const link = document.createElement('link')
link.type = 'text/css'
link.rel = 'stylesheet'
link.href = '${webpackUrl("commons.css", baseUrl)}'
document.head.appendChild(link)

let loadedScripts = 0;
const checkReady = () => {
    loadedScripts++
    if (loadedScripts === 3)
        window.MultiEmbedderSingleton.embedAll()
}

const coreScripts = [
    'https://polyfill.io/v3/polyfill.min.js?features=es6,fetch,URL,IntersectionObserver,IntersectionObserverEntry',
    '${webpackUrl("commons.js", baseUrl)}',
    '${webpackUrl("owid.js", baseUrl)}'
]

coreScripts.forEach(url => {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.onload = checkReady
    script.src = url
    document.head.appendChild(script)
})
}
embedSnippet()
`
