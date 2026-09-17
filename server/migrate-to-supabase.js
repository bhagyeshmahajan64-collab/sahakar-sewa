require("dotenv").config();

const fs = require("fs");
const path = require("path");
const supabase = require("./supabase");

const DATA_FILE = path.join(__dirname, "data", "database.json");

function fail(message) {
  console.error("\n❌ MIGRATION FAILED");
  console.error(message);
  process.exit(1);
}

async function insert(table, rows) {
  if (!rows || rows.length === 0) {
    console.log(`ℹ️ ${table}: no rows to migrate`);
    return;
  }

  const { error } = await supabase
    .from(table)
    .insert(rows);

  if (error) {
    fail(`${table}: ${error.message}`);
  }

  console.log(`✅ ${table}: ${rows.length} row(s) migrated`);
}

async function main() {
  console.log("\n====================================");
  console.log(" SAHAKAR SEWA SUPABASE MIGRATION");
  console.log("====================================\n");

  if (!fs.existsSync(DATA_FILE)) {
    fail(`database.json not found at:\n${DATA_FILE}`);
  }

  let db;

  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    fail(`Could not read database.json: ${error.message}`);
  }

  console.log("📦 Local database loaded");
  console.log(`Users: ${db.users?.length || 0}`);
  console.log(`Workers: ${db.workers?.length || 0}`);
  console.log(`Services: ${db.services?.length || 0}`);
  console.log(`Bookings: ${db.bookings?.length || 0}`);
  console.log(`Payments: ${db.payments?.length || 0}`);
  console.log(`Feedback: ${db.feedback?.length || 0}`);
  console.log("");

  /*
   * IMPORTANT:
   * Insert parent records first because our
   * Supabase schema uses foreign keys.
   */

  // ------------------------------------------
  // USERS
  // ------------------------------------------

  const users = (db.users || []).map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    password: u.password,
    created_at: u.createdAt || new Date().toISOString()
  }));

  await insert("users", users);

  // ------------------------------------------
  // SERVICES
  // ------------------------------------------

  const services = (db.services || []).map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description || "",
    price: Number(s.price || 0),
    icon: s.icon || "🛠️",
    active: s.active !== false,
    created_at: s.createdAt || new Date().toISOString()
  }));

  await insert("services", services);

  // ------------------------------------------
  // WORKERS
  // ------------------------------------------

  const workers = (db.workers || []).map(w => ({
    id: w.id,
    user_id: w.userId,
    name: w.name,
    phone: w.phone || "",
    skills: w.skills || [],
    documents: w.documents || [],
    verified: !!w.verified,
    verification_status: w.verificationStatus || "pending",
    rating: Number(w.rating || 0),
    jobs: Number(w.jobs || 0),
    workload: Number(w.workload || 0),
    location: w.location || null,
    available: !!w.available,
    cooperative: w.cooperative || "",
    created_at: w.createdAt || new Date().toISOString()
  }));

  await insert("workers", workers);

  // ------------------------------------------
  // BOOKINGS
  // ------------------------------------------

  const bookings = (db.bookings || []).map(b => ({
    id: b.id,
    customer_id: b.customerId,
    service_id: b.serviceId,
    service_name: b.serviceName,
    issue: b.issue,
    scheduled_at: b.scheduledAt || null,
    location: b.location || {},
    emergency: !!b.emergency,
    amount: Number(b.amount || 0),
    status: b.status || "SEARCHING",
    worker_id: b.workerId || null,
    payment_id: b.paymentId || null,
    timeline: b.timeline || [],
    created_at: b.createdAt || new Date().toISOString(),
    updated_at: b.updatedAt || new Date().toISOString()
  }));

  /*
   * bookings.payment_id references payments.id.
   *
   * Because payments themselves reference bookings,
   * we cannot insert payment-linked booking rows first
   * when the payment foreign key is enforced.
   *
   * Therefore temporarily remove payment_id.
   */

  const bookingsWithoutPayment = bookings.map(b => ({
    ...b,
    payment_id: null
  }));

  await insert("bookings", bookingsWithoutPayment);

  // ------------------------------------------
  // PAYMENTS
  // ------------------------------------------

  const payments = (db.payments || []).map(p => ({
    id: p.id,
    booking_id: p.bookingId,
    amount: Number(p.amount || 0),
    method: p.method || "UPI",
    status: p.status || "PAID",
    split: p.split || {},
    paid_at: p.paidAt || new Date().toISOString()
  }));

  await insert("payments", payments);

  // ------------------------------------------
  // RESTORE PAYMENT IDs
  // ------------------------------------------

  for (const booking of bookings) {
    if (!booking.payment_id) continue;

    const { error } = await supabase
      .from("bookings")
      .update({
        payment_id: booking.payment_id
      })
      .eq("id", booking.id);

    if (error) {
      fail(
        `Could not restore payment_id for booking ${booking.id}: ${error.message}`
      );
    }
  }

  console.log(
    bookings.some(b => b.payment_id)
      ? "✅ Booking payment relationships restored"
      : "ℹ️ No booking payment relationships to restore"
  );

  // ------------------------------------------
  // FEEDBACK
  // ------------------------------------------

  const feedback = (db.feedback || []).map(f => ({
    id: f.id,
    booking_id: f.bookingId,
    customer_id: f.customerId,
    worker_id: f.workerId || null,
    rating: Number(f.rating),
    comment: f.comment || "",
    created_at: f.createdAt || new Date().toISOString()
  }));

  await insert("feedback", feedback);

  console.log("\n====================================");
  console.log("✅ MIGRATION COMPLETED");
  console.log("====================================\n");
}

main().catch(error => {
  console.error("\n❌ Unexpected migration error:");
  console.error(error);
  process.exit(1);
});