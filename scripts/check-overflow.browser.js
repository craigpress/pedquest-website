/*
 * Mobile overflow + tap-target check. Paste into the devtools console (or run
 * through a browser-automation "evaluate") on any page of the running site at
 * a 375 px viewport. Each route loads in a same-origin iframe of WIDTH px with
 * the body{overflow-x:clip} safety net switched off, so real horizontal
 * overflow shows up instead of being hidden.
 *
 * Reports per route: page height, scrollWidth vs innerWidth (fail when wider),
 * the outermost elements that stick out, and visible controls under 40 px tall.
 *
 *   await pqCheckOverflow()                      // default routes
 *   await pqCheckOverflow(["/about", "/privacy"]) // custom list
 */
window.pqCheckOverflow = async function pqCheckOverflow(
  routes = [
    "/", "/about", "/publications", "/members", "/events", "/education",
    "/education/question-bank", "/education/eeg-reference", "/privacy",
    "/contact", "/join", "/sponsor", "/courses", "/admin/eeg-lab/library",
  ],
  WIDTH = 375,
  HEIGHT = 812,
) {
  const results = [];
  for (const route of routes) {
    const frame = document.createElement("iframe");
    frame.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;border:0;opacity:0;pointer-events:none;z-index:-1`;
    frame.src = route;
    document.body.appendChild(frame);
    await new Promise((r) => frame.addEventListener("load", r, { once: true }));
    await new Promise((r) => setTimeout(r, 2500)); // client data + fonts
    const w = frame.contentWindow;
    const d = frame.contentDocument;
    d.documentElement.style.overflowX = "visible";
    d.body.style.overflowX = "visible";
    const vw = w.innerWidth;
    const scrollWidth = d.documentElement.scrollWidth;

    // Outermost offenders: stick out past the viewport, parent does not.
    const clipsX = (el) => {
      const o = w.getComputedStyle(el).overflowX;
      return o === "auto" || o === "scroll" || o === "hidden" || o === "clip";
    };
    const sticksOut = (el) => el.getBoundingClientRect().right > vw + 0.5;
    const offenders = [];
    for (const el of d.body.querySelectorAll("*")) {
      if (!sticksOut(el)) continue;
      let p = el.parentElement, hidden = false;
      while (p && p !== d.body) { if (clipsX(p)) { hidden = true; break; } p = p.parentElement; }
      if (hidden) continue;
      if (el.parentElement && el.parentElement !== d.body && sticksOut(el.parentElement)) continue;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      offenders.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(el.getBoundingClientRect().right)}`);
    }

    const small = [...d.querySelectorAll("a[href], button, select, input:not([type=hidden]), [role=button], [role=tab]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 40 && w.getComputedStyle(el).visibility !== "hidden";
      });

    results.push({
      route,
      height: d.documentElement.scrollHeight,
      scrollWidth,
      innerWidth: vw,
      overflow: scrollWidth > vw ? "FAIL" : "ok",
      offenders: offenders.slice(0, 5).join(" | "),
      under40: small.length,
    });
    frame.remove();
  }
  console.table(results);
  return results;
};
