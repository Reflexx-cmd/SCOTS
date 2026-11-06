/* ============================================================
   SCOTS — queue.js
   Kitchen queue + ETA engine. ETAs are computed once at order
   placement and frozen — the customer's locked ETA never changes.

   Model: a single kitchen line. Every active order occupies a
   busy block of kitchen time:
     • Scheduled pickup orders finish at their slot start, so they
       are busy  [slotStart − prep,  slotStart].
     • Normal-queue (walk-in) orders finish at their locked ETA,
       busy  [eta − prep,  eta].

   A new walk-in order fills the earliest gap that fits it —
   otherwise it starts after the block that overlaps it.
   Example: a scheduled 12:00 pickup with 10-min prep is busy
   11:50–12:00. A walk-in at 11:55 needing 15 min cannot fit in
   the 5-minute gap, so it starts at 12:00 and is ready 12:15.
   ============================================================ */

const Queue = {
  ACTIVE_STATUSES: ["received", "preparing"],

  /* Busy kitchen blocks [startMin, endMin] from active orders, sorted */
  busyBlocks() {
    const blocks = [];
    DB.getOrders()
      .filter(o => this.ACTIVE_STATUSES.includes(o.status))
      .forEach(o => {
        const prep = o.prepMinutes || 0;
        if (!prep) return;
        let end = null;
        if (o.mode === "scheduled" && o.slotId) {
          const slot = Slots.byId(o.slotId);
          if (slot) end = slot.startMin;
        } else if (o.eta) {
          const d = new Date(o.eta);
          end = d.getHours() * 60 + d.getMinutes();
        }
        if (end == null) return;
        blocks.push([end - prep, end]);
      });
    return blocks.sort((a, b) => a[0] - b[0]);
  },

  /* FR12.5/FR15: Scheduled Order stays hidden until its Promised Release Time */
  isHeld(o) {
    if (o.mode !== "scheduled" || o.status !== "received") return false;
    const rel = o.promisedReleaseMin != null ? o.promisedReleaseMin
      : (Slots.byId(o.slotId) ? Slots.byId(o.slotId).startMin - (o.prepMinutes || 0) : 0);
    return TimeUtil.nowMinutes() < rel;
  },

  /* Prep minutes currently in the kitchen pipeline (for stats) */
  activeQueueMinutes() {
    return DB.getOrders()
      .filter(o => this.ACTIVE_STATUSES.includes(o.status))
      .reduce((s, o) => s + (o.prepMinutes || 0), 0);
  },

  activeCount() {
    return DB.getOrders().filter(o => this.ACTIVE_STATUSES.includes(o.status)).length;
  },

  /* Earliest kitchen start (minutes-of-day) for a walk-in needing `prep` minutes */
  earliestStart(prep, fromMin) {
    let t = fromMin;
    for (const [s, e] of this.busyBlocks()) {
      if (t + prep <= s) break;            // fits in the gap before this block
      if (t < e && t + prep > s) t = e;    // overlaps → start after this block
    }
    return t;
  },

  /*
   * computeETA(prepMinutes, mode, slotId)
   *   mode: "asap" (normal queue) | "scheduled" (pickup slot)
   *   -> { etaDate, waitMinutes, startMin, readyMin }
   */
  computeETA(prepMinutes, mode, slotId) {
    const now = TimeUtil.now();
    const nowM = TimeUtil.nowMinutes();

    if (mode === "scheduled" && slotId) {
      const slot = Slots.byId(slotId);
      if (slot) {
        const ready = slot.startMin; // food hot at the start of the pickup window
        const wait = Math.max(1, ready - nowM);
        return {
          etaDate: new Date(now.getTime() + wait * 60000),
          waitMinutes: wait,
          startMin: ready - prepMinutes,
          readyMin: ready,
        };
      }
    }

    /* Normal queue — earliest gap in the kitchen line */
    const start = this.earliestStart(prepMinutes, nowM);
    const ready = start + prepMinutes;
    const wait = Math.max(1, ready - nowM);
    return {
      etaDate: new Date(now.getTime() + wait * 60000),
      waitMinutes: wait,
      startMin: start,
      readyMin: ready,
    };
  },

  /* Can this order plausibly finish before closing time? */
  completesBeforeClose(prepMinutes, mode, slotId) {
    return this.computeETA(prepMinutes, mode, slotId).readyMin <= TimeUtil.CLOSE_MIN;
  },
};
