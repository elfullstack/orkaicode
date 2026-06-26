import { Flag } from "@opencode-ai/core/flag/flag"

/**
 * Fork distribution identity — update checks and self-upgrade must not contact
 * upstream anomalyco/opencode or opencode-ai npm releases.
 */
export const GITHUB_REPO = "elfullstack/orkaicode"

export const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`

export const latestReleaseApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export function releaseTarget() {
  const os = process.platform === "win32" ? "windows" : process.platform
  if (os !== "darwin" && os !== "linux" && os !== "windows") return undefined
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined
  return `${os}-${process.arch}`
}

export function releaseArchiveFilename(target: string) {
  const ext = target.startsWith("linux-") ? ".tar.gz" : ".zip"
  return `opencode-${target}${ext}`
}

export function releaseDownloadUrl(version: string, target: string) {
  const tag = version.replace(/^v/, "")
  return `https://github.com/${GITHUB_REPO}/releases/download/v${tag}/${releaseArchiveFilename(target)}`
}

export function autoupdateAllowed(config: { autoupdate?: boolean | "notify" }) {
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return false
  if (config.autoupdate === true || config.autoupdate === "notify") return true
  return false
}

export function upgradeMessage() {
  return `Download new releases from ${releasesUrl} or run \`opencode upgrade\``
}

export * as Distribution from "./distribution"
