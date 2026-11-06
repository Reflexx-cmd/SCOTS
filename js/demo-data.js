/* ============================================================
   SCOTS — demo-data.js
   Seeds demo users, menu, slots and settings.
   ============================================================ */

const DEMO_USERS = [
  {
    id: "u-student",
    role: "student",
    name: "Demo Customer",
    enrollment: "DEMO-STU-01",
    email: "student@example.com",
    phone: "+91 00000 00001",
    password: "Student@123",
    noShows: 0,
    paymentMode: "normal",       // normal | mandatory_upi
    status: "active",            // active | suspended
  },
  {
    id: "u-staff",
    role: "staff",
    name: "Canteen Staff",
    enrollment: "DEMO-STAFF-01",
    email: "staff@example.com",
    phone: "+91 00000 00002",
    password: "Staff@123",
    noShows: 0,
    paymentMode: "normal",
    status: "active",
  },
  {
    id: "u-admin",
    role: "admin",
    name: "Canteen Admin",
    enrollment: "DEMO-ADMIN-01",
    email: "admin@example.com",
    phone: "+91 00000 00003",
    password: "Admin@123",
    noShows: 0,
    paymentMode: "normal",
    status: "active",
  },
];

const DEMO_MENU = [
  { id: "m1",  name: "Veg Burger",      category: "Snacks",    price: 60, prepTime: 10, rating: 4.5, image: "assets/food/veg-burger.jpg",      ingredients: "Crispy veg patty, lettuce, tomato, house sauce",           description: "A golden toasted bun stacked with a crunchy vegetable patty and our tangy house sauce.", soldOut: false, available: true, popular: true  },
  { id: "m2",  name: "Cheese Sandwich", category: "Breakfast", price: 45, prepTime: 8,  rating: 4.3, image: "assets/food/cheese-sandwich.jpg",  ingredients: "Grilled bread, cheddar, green chutney",                      description: "Grilled golden with a generous molten cheddar centre and a swipe of green chutney.",      soldOut: false, available: true, popular: false },
  { id: "m3",  name: "Masala Dosa",     category: "Breakfast", price: 70, prepTime: 15, rating: 4.7, image: "assets/food/masala-dosa.jpg",      ingredients: "Golden dosa, spiced potato, coconut chutney, sambar",         description: "Crisp, buttery dosa wrapped around spiced potato bhaji, served with chutney and sambar.",  soldOut: false, available: true, popular: true  },
  { id: "m4",  name: "Paneer Wrap",     category: "Meals",     price: 80, prepTime: 12, rating: 4.6, image: "assets/food/paneer-wrap.jpg",      ingredients: "Grilled wrap, tikka paneer, pickled onion, mint mayo",       description: "Char-grilled roti wrapped around smoky paneer tikka and crunchy pickled onions.",         soldOut: false, available: true, popular: true  },
  { id: "m5",  name: "Veg Pizza",       category: "Meals",     price: 99, prepTime: 18, rating: 4.4, image: "assets/food/veg-pizza.jpg",        ingredients: "Cheese, capsicum, sweet corn, onion, oregano",               description: "A personal-size pizza loaded with molten cheese and garden vegetables.",                soldOut: false, available: true, popular: false },
  { id: "m6",  name: "French Fries",    category: "Snacks",    price: 50, prepTime: 8,  rating: 4.2, image: "assets/food/french-fries.jpg",     ingredients: "Crispy fries, peri-peri dust, ketchup",                      description: "Twice-fried golden fries dusted with peri-peri, served with ketchup.",                  soldOut: false, available: true, popular: false },
  { id: "m7",  name: "Cold Coffee",     category: "Beverages", price: 40, prepTime: 5,  rating: 4.5, image: "assets/food/cold-coffee.jpg",      ingredients: "Cold-brewed coffee, chilled milk, whipped foam",             description: "Frothy, chilled and just sweet enough — the lecture-break classic.",                    soldOut: false, available: true, popular: true  },
  { id: "m8",  name: "Masala Chai",     category: "Beverages", price: 15, prepTime: 4,  rating: 4.8, image: "assets/food/masala-chai.jpg",      ingredients: "Kulhad chai, ginger, cardamom, lemongrass",                  description: "Slow-brewed with crushed ginger and cardamom, served piping hot in a kulhad.",           soldOut: false, available: true, popular: false },
  { id: "m9",  name: "Samosa",          category: "Snacks",    price: 20, prepTime: 6,  rating: 4.6, image: "assets/food/samosa.jpg",           ingredients: "Crisp pastry, spiced potato-pea filling, mint chutney",        description: "Flaky, shattering crust with a warm spiced potato filling. Sold as a pair.",             soldOut: false, available: true, popular: true  },
  { id: "m10", name: "Veg Maggi",       category: "Meals",     price: 35, prepTime: 10, rating: 4.4, image: "assets/food/veg-maggi.jpg",        ingredients: "Masala noodles, green peas, carrots, coriander",             description: "The hostel favourite — masala noodles tossed with peas and carrots.",                   soldOut: true,  available: true, popular: false },
];

/* 15-minute slots from 09:00 to 18:00, each with a prep-minute capacity */
function buildDemoSlots() {
  const slots = [];
  for (let m = 9 * 60; m < 18 * 60; m += 15) {
    slots.push({ id: "slot-" + m, startMin: m, capacity: Policy.schedCapacity(), enabled: true });
  }
  return slots;
}

const DEFAULT_SETTINGS = {
  demoMode: false,
  serviceFee: 5,
  tokenCounter: 103,
  simulate: { enabled: true, minutes: 12 * 60 + 30 },
};

function seedDemoData(force) {
  const already = localStorage.getItem(LS_KEYS.SETTINGS);
  if (already && !force) return;
  DB.saveUsers(JSON.parse(JSON.stringify(DEMO_USERS)));
  DB.saveMenu(JSON.parse(JSON.stringify(DEMO_MENU)));
  DB.saveSlots(buildDemoSlots());
  DB.saveOrders([]);
  DB.saveCart([]);
  Store.write(LS_KEYS.TXN, []);
  Store.write(LS_KEYS.AUDIT, []);
  Store.write(LS_KEYS.APPEALS, []);
  Store.write(LS_KEYS.NOTIFICATIONS, []);
  DB.saveSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  DB.clearCurrentUser();
  sessionStorage.removeItem("scots_buy_now");
}

/* Seed a believable spread of orders for staff/admin dashboards */
function seedDemoOrders() {
  const user = DB.getUserById("u-student");
  if (!user) return;
  const menu = DB.getMenu();
  const nowM = TimeUtil.nowMinutes();
  const mk = (i, slotOff, status, minsAgo) => {
    const slotStart = Math.max(9 * 60, Math.min(17 * 60 + 45, nowM + slotOff));
    const items = [
      { id: menu[i % menu.length].id, name: menu[i % menu.length].name, price: menu[i % menu.length].price, qty: 1, image: menu[i % menu.length].image, prepTime: menu[i % menu.length].prepTime },
    ];
    const placed = new Date(TimeUtil.now().getTime() - minsAgo * 60000);
    const eta = new Date(placed.getTime() + 18 * 60000);
    const o = {
      id: "o-demo-" + Date.now() + "-" + i,
      token: DB.nextToken(),
      userId: user.id, userName: user.name,
      items,
      subtotal: items[0].price, serviceFee: 5, total: items[0].price + 5,
      prepMinutes: items[0].prepTime,
      payment: { mode: i % 2 === 0 ? "upi" : "counter", status: i % 2 === 0 ? "paid" : "pending" },
      slotId: "slot-" + (slotStart - (slotStart % 15)),
      slotLabel: TimeUtil.minsToLabel(slotStart - (slotStart % 15)) + " – " + TimeUtil.minsToLabel(slotStart - (slotStart % 15) + 15),
      placedAt: placed.toISOString(),
      eta: eta.toISOString(), waitMinutes: 18,
      mode: "scheduled",
      status,
      readyAt: status === "ready" ? new Date(placed.getTime() + 12 * 60000).toISOString() : null,
      statusHistory: [{ status: "received", at: placed.toISOString() }],
    };
    DB.addOrder(o);
  };
  mk(0, 30, "received", 4);
  mk(2, 45, "preparing", 9);
  mk(3, 60, "preparing", 13);
  mk(6, 15, "ready", 16);
  mk(8, 20, "ready", 19);
  DB.addAudit({ type: "seed", message: "Demo orders seeded" });
}
