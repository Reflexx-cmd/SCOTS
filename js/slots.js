/* ============================================================
   SCOTS — slots.js
   15-minute pickup slots with prep-minute capacity tracking.
   ============================================================ */

const Slots = {
  all() { return DB.getSlots(); },

  /* Reserved prep-minutes per slot from active orders */
  reservedBySlot(slotId) {
    return DB.getOrders()
      .filter(o => o.slotId === slotId && ["received", "preparing", "ready"].includes(o.status))
      .reduce((s, o) => s + (o.prepMinutes || 0), 0);
  },

  label(slot) {
    return TimeUtil.minsToLabel(slot.startMin) + " – " + TimeUtil.minsToLabel(slot.startMin + 15);
  },

  /* Full computed state for every slot, given an order's prep need */
  state(needMinutes) {
    const nowM = TimeUtil.nowMinutes();
    return this.all().map(slot => {
      const reserved = this.reservedBySlot(slot.id);
      const remaining = slot.capacity - reserved;
      const past = slot.startMin + 15 <= nowM;
      const tooLate = slot.startMin + needMinutes > TimeUtil.CLOSE_MIN;
      const tooSoon = slot.startMin - nowM < Policy.get().minLeadMin; /* FR12.1 */
      const fits = remaining >= (needMinutes || 0);
      const usable = slot.enabled && !past && !tooLate && !tooSoon && fits;
      return {
        ...slot, reserved, remaining, past, tooLate, tooSoon, fits, usable,
        full: slot.enabled && !past && !tooSoon && (!fits || tooLate),
        label: this.label(slot),
      };
    });
  },

  /* Only slots the student could actually pick right now */
  upcoming(needMinutes) {
    return this.state(needMinutes).filter(s => !s.past);
  },

  /* Nearest available slot that fits the order */
  suggest(needMinutes) {
    const ok = this.upcoming(needMinutes).find(s => s.usable);
    return ok || null;
  },

  byId(id) { return this.all().find(s => s.id === id) || null; },

  setCapacity(id, capacity) {
    const slots = this.all().map(s => s.id === id ? { ...s, capacity: Math.max(5, capacity) } : s);
    DB.saveSlots(slots);
    DB.addAudit({ type: "slot", message: `Slot ${this.label(this.byId(id))} capacity set to ${capacity} min` });
  },

  setEnabled(id, enabled) {
    const slots = this.all().map(s => s.id === id ? { ...s, enabled } : s);
    DB.saveSlots(slots);
    DB.addAudit({ type: "slot", message: `Slot ${this.label(this.byId(id))} ${enabled ? "enabled" : "disabled"}` });
  },
};
