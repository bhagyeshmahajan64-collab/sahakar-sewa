const bcrypt = require("bcryptjs");
const supabase = require("./supabase");

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function publicUser(u) {
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    createdAt: u.created_at || u.createdAt
  };
}

async function getUser(idOrEmail) {
  if (!idOrEmail) return null;

  const value = String(idOrEmail).trim();

  // First try ID
  let result = await supabase
    .from("users")
    .select("*")
    .eq("id", value)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data) {
    return result.data;
  }

  // Then try email
  result = await supabase
    .from("users")
    .select("*")
    .eq("email", value.toLowerCase())
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data || null;
}

async function getWorker(workerId) {
  if (!workerId) return null;

  const { data, error } = await supabase
    .from("workers")
    .select("*")
    .eq("id", workerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function getWorkerByUser(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("workers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function getBooking(bookingId) {
  if (!bookingId) return null;

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function createUser({
  name,
  email,
  password,
  phone,
  role
}) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const existing = await getUser(normalizedEmail);

  if (existing) {
    throw new Error("Email already registered");
  }

  const user = {
    id: id("u"),
    name: String(name).trim(),
    email: normalizedEmail,
    phone: phone || "",
    role,
    password: await bcrypt.hash(password, 12),
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("users")
    .insert(user)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getServices(activeOnly = false) {
  let query = supabase
    .from("services")
    .select("*")
    .order("created_at", { ascending: false });

  if (activeOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function getService(serviceId) {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function createService(service) {
  const { data, error } = await supabase
    .from("services")
    .insert(service)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function updateService(serviceId, updates) {
  const { data, error } = await supabase
    .from("services")
    .update(updates)
    .eq("id", serviceId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getWorkers() {
  const { data, error } = await supabase
    .from("workers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function createWorker(worker) {
  const row = {
    id: worker.id,
    user_id: worker.userId,
    name: worker.name,
    phone: worker.phone || "",
    skills: worker.skills || [],
    documents: worker.documents || [],
    verified: !!worker.verified,
    verification_status: worker.verificationStatus || "pending",
    rating: Number(worker.rating || 0),
    jobs: Number(worker.jobs || 0),
    workload: Number(worker.workload || 0),
    location: worker.location || null,
    available: !!worker.available,
    cooperative: worker.cooperative || "",
    created_at: worker.createdAt || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("workers")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function updateWorker(workerId, updates) {
  const { data, error } = await supabase
    .from("workers")
    .update(updates)
    .eq("id", workerId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function createBooking(booking) {
  const row = {
    id: booking.id,
    customer_id: booking.customerId,
    service_id: booking.serviceId,
    service_name: booking.serviceName,
    issue: booking.issue,
    scheduled_at: booking.scheduledAt || null,
    location: booking.location || {},
    emergency: !!booking.emergency,
    amount: Number(booking.amount || 0),
    status: booking.status || "SEARCHING",
    worker_id: booking.workerId || null,
    payment_id: booking.paymentId || null,
    timeline: booking.timeline || [],
    created_at: booking.createdAt || new Date().toISOString(),
    updated_at: booking.updatedAt || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function updateBooking(bookingId, updates) {
  const { data, error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", bookingId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("paid_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function createPayment(payment) {
  const row = {
    id: payment.id,
    booking_id: payment.bookingId,
    amount: Number(payment.amount || 0),
    method: payment.method || "UPI",
    status: payment.status || "PAID",
    split: payment.split || {},
    paid_at: payment.paidAt || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("payments")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getFeedbackForBooking(bookingId) {
  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function createFeedback(feedback) {
  const row = {
    id: feedback.id,
    booking_id: feedback.bookingId,
    customer_id: feedback.customerId,
    worker_id: feedback.workerId || null,
    rating: Number(feedback.rating),
    comment: feedback.comment || "",
    created_at: feedback.createdAt || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("feedback")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

module.exports = {
  bcrypt,
  id,
  publicUser,

  getUser,
  getWorker,
  getWorkerByUser,
  getBooking,

  createUser,

  getServices,
  getService,
  createService,
  updateService,

  getWorkers,
  createWorker,
  updateWorker,

  getBookings,
  createBooking,
  updateBooking,

  getPayments,
  createPayment,

  getFeedbackForBooking,
  createFeedback
};