import { Flag } from "@opencode-ai/core/flag/flag"

/**
 * Fork distribution identity — update checks and self-upgrade must not contact
 * upstream anomalyco/opencode or opencode-ai npm releases.
 */
export const GITHUB_REPO = "elfullstack/orkaicode"

export const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`

export const latestReleaseApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export function autoupdateAllowed(config: { autoupdate?: boolean | "notify" }) {
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return false
  if (config.autoupdate === true || config.autoupdate === "notify") return true
  return false
}

export function upgradeMessage() {
  return `Self-update is disabled for this distribution. Download new releases from ${releasesUrl}`
}

export * as Distribution from "./distribution"
