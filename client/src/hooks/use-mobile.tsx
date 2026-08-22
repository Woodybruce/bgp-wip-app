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

// True while the on-screen keyboard is (probably) open — the visual
// viewport shrinks well below the layout viewport. Used to hide the fixed
// bottom nav while typing (it otherwise floats above the iOS keyboard) and
// to collapse the nav-clearance padding under chat composers.
export function useKeyboardOpen() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // BOTH conditions required: a text field is focused AND the visual
    // viewport has shrunk. Viewport height alone misfires — Safari's
    // collapsing toolbar and slow post-dismiss viewport restores left the
    // nav hidden with a blank band at the bottom (Woody, 2026-08-22
    // "lots of space at the bottom").
    const textFocused = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
    }
    const update = () => setOpen(textFocused() && window.innerHeight - vv.height > 140)
    // iOS standalone (home-screen) bug: after the keyboard dismisses, WebKit
    // sometimes leaves the layout viewport SHORT, so bottom-anchored fixed
    // elements (the tab bar) float above a dead white band (Woody, 2026-08-22
    // screenshot: ~68pt gap under the nav, no keyboard up). A scroll nudge +
    // one-frame root-height jiggle forces the viewport to recompute. Safe on
    // our mobile shells: they're `fixed inset-0` with inner scrollers, so the
    // window itself never legitimately scrolls.
    const healViewport = () => {
      if (textFocused()) return
      window.scrollTo(0, 0)
      const de = document.documentElement
      de.style.height = "100.1%"
      requestAnimationFrame(() => { de.style.height = "" })
    }
    // focusout fires before the viewport grows back — schedule a re-check
    // so the nav returns promptly once the keyboard is gone.
    const deferredUpdate = () => {
      update()
      setTimeout(update, 120)
      setTimeout(() => { update(); healViewport() }, 400)
    }
    // Returning to a backgrounded app can land on an already-stuck viewport.
    const onShow = () => { if (!document.hidden) setTimeout(healViewport, 100) }
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    window.addEventListener("focusin", deferredUpdate)
    window.addEventListener("focusout", deferredUpdate)
    window.addEventListener("pageshow", onShow)
    document.addEventListener("visibilitychange", onShow)
    update()
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
      window.removeEventListener("focusin", deferredUpdate)
      window.removeEventListener("focusout", deferredUpdate)
      window.removeEventListener("pageshow", onShow)
      document.removeEventListener("visibilitychange", onShow)
    }
  }, [])

  return open
}
