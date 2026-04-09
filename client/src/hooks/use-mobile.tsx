import * as React from "react"

const MOBILE_BREAKPOINT = 768
const DESKTOP_MODE_KEY = "bgp-force-desktop"

function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0
  if (!hasTouch) return false
  const ua = navigator.userAgent || ""
  if (/Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true
  if (/Windows|Macintosh|Linux/.test(ua) && !/Android/.test(ua)) return false
  return hasTouch
}

function checkIsMobile(ignoreForceDesktop = false): boolean {
  if (typeof window === "undefined") return false
  if (!ignoreForceDesktop && getForceDesktop()) return false
  const narrow = Math.min(window.innerWidth, window.innerHeight) < MOBILE_BREAKPOINT
  return narrow && isTouchDevice()
}

export function isNativeMobile(): boolean {
  if (typeof window === "undefined") return false
  const narrow = Math.min(window.innerWidth, window.innerHeight) < MOBILE_BREAKPOINT
  return narrow && isTouchDevice()
}

export function getForceDesktop(): boolean {
  try {
    return localStorage.getItem(DESKTOP_MODE_KEY) === "true"
  } catch {
    return false
  }
}

export function setForceDesktop(value: boolean) {
  try {
    if (value) {
      localStorage.setItem(DESKTOP_MODE_KEY, "true")
    } else {
      localStorage.removeItem(DESKTOP_MODE_KEY)
    }
    window.dispatchEvent(new Event("force-desktop-changed"))
  } catch {}
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(checkIsMobile)

  React.useEffect(() => {
    const update = () => setIsMobile(checkIsMobile())
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", update)
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    window.addEventListener("force-desktop-changed", update)
    update()
    return () => {
      mql.removeEventListener("change", update)
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
      window.removeEventListener("force-desktop-changed", update)
    }
  }, [])

  return isMobile
}
