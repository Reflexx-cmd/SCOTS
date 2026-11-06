/* ============================================================
   SCOTS — menu.js
   Menu page: search, categories, popular rail, food grid.
   ============================================================ */

const MenuPage = {
  category: "All",
  query: "",

  categories() {
    const cats = ["All", ...new Set(DB.getMenu().map(m => m.category))];
    return cats;
  },

  filtered() {
    const q = this.query.trim().toLowerCase();
    return DB.getMenu().filter(item => {
      const catOk = this.category === "All" || item.category === this.category;
      const qOk = !q || item.name.toLowerCase().includes(q) || item.ingredients.toLowerCase().includes(q);
      return catOk && qOk;
    });
  },

  render() {
    /* Category chips */
    const chips = document.getElementById("category-chips");
    chips.innerHTML = this.categories().map(c =>
      `<button class="chip ${c === this.category ? "active" : ""}" data-cat="${U.esc(c)}">${U.esc(c)}</button>`
    ).join("");

    /* Grid */
    const grid = document.getElementById("menu-grid");
    const items = this.filtered();
    const cartBusy = Cart.hasItems(); // Buy Now disabled while cart has items
    if (!items.length) {
      grid.innerHTML = emptyStateHTML(
        "🍽️",
        "Nothing matches that craving",
        "Try a different search or category — the kitchen has plenty more.",
        `<button class="btn btn-soft" id="clear-filters">Clear filters</button>`
      );
      const cf = document.getElementById("clear-filters");
      if (cf) cf.onclick = () => { this.category = "All"; this.query = ""; document.getElementById("menu-search").value = ""; this.render(); };
    } else {
      grid.innerHTML = items.map(item =>
        foodCardHTML(item, Cart.qtyOf(item.id), !cartBusy)
      ).join("");
    }

    /* Popular rail */
    const rail = document.getElementById("popular-rail");
    if (rail) {
      const popular = DB.getMenu().filter(m => m.popular && !m.soldOut && m.available);
      rail.innerHTML = popular.map(item => foodCardHTML(item, Cart.qtyOf(item.id), !cartBusy)).join("");
    }
  },

  init() {
    const user = Auth.guard("student");
    if (!user) return;

    /* Closed-hours notice */
    const notice = document.getElementById("hours-notice");
    if (!TimeUtil.isOpen()) {
      notice.innerHTML = `
        <div class="closed-banner" role="status">
          <span class="cb-icon" aria-hidden="true">🌙</span>
          <div>
            <strong>Ordering is currently closed</strong>
            <p>The canteen accepts orders 09:00 AM – 06:00 PM IST. We open again ${TimeUtil.nextOpeningLabel()}.</p>
          </div>
        </div>`;
    } else {
      notice.innerHTML = "";
    }

    /* Suspension notice */
    if (user.status === "suspended") {
      document.getElementById("account-notice").innerHTML = `
        <div class="notice error" role="alert">
          <span aria-hidden="true">⛔</span>
          <div><strong>Your account has been temporarily suspended due to repeated pickup no-shows.</strong>
          Ordering is disabled. Please contact the canteen office or use the <a href="help.html#appeal" style="text-decoration:underline">appeal form</a>.</div>
        </div>`;
    } else if (user.paymentMode === "mandatory_upi") {
      document.getElementById("account-notice").innerHTML = `
        <div class="notice warn" role="status">
          <span aria-hidden="true">⚠️</span>
          <div><strong>UPI payment is now mandatory for your account.</strong>
          This follows 2 pickup no-shows. You can appeal in <a href="help.html#appeal" style="text-decoration:underline">Help</a> to have it reviewed.</div>
        </div>`;
    }

    const search = document.getElementById("menu-search");
    search.addEventListener("input", e => { this.query = e.target.value; this.render(); });

    document.getElementById("category-chips").addEventListener("click", e => {
      const chip = e.target.closest("[data-cat]");
      if (!chip) return;
      this.category = chip.dataset.cat;
      this.render();
    });

    const main = document.getElementById("menu-main");
    wireFoodCards(main, () => this.render());

    /* Skeleton first paint */
    const grid = document.getElementById("menu-grid");
    grid.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
    setTimeout(() => this.render(), 350);

    this.render();
  },
};

document.addEventListener("DOMContentLoaded", () => MenuPage.init());
