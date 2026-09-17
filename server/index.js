require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const {
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
} = require("./store");

const supabase = require("./supabase");

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET || "change-me-before-deploying";

const ADMIN_SETUP_CODE =
  process.env.ADMIN_SETUP_CODE || "setup-admin";

/* =========================================================
   ROLE HELPERS
========================================================= */

function normalizeRole(role) {
  if (role === undefined || role === null) {
    return "";
  }

  const value = String(role)
    .trim()
    .toLowerCase();

  // Normalize common role variations
  const roleMap = {
    customer: "customer",
    customers: "customer",
    user: "customer",
    users: "customer",
    client: "customer",
    clients: "customer",

    worker: "worker",
    workers: "worker",
    service_worker: "worker",
    serviceworker: "worker",
    technician: "worker",
    technicians: "worker",

    admin: "admin",
    admins: "admin",
    administrator: "admin",
    administrators: "admin"
  };

  return roleMap[value] || value;
}

function isValidRole(role) {
  return ["customer", "worker", "admin"].includes(
    normalizeRole(role)
  );
}

/* =========================================================
   HELPERS
========================================================= */

function tokenFor(user) {
  const role = normalizeRole(user.role);

  return jwt.sign(
    {
      id: user.id,
      role,
      name: user.name
    },
    JWT_SECRET,
    {
      expiresIn: "12h"
    }
  );
}

/*
  IMPORTANT:
  This middleware now verifies the JWT AND refreshes the
  user's role from the database.

  This prevents:
  "Role not allowed"

  when an old JWT contains the wrong/capitalized role.
*/
async function auth(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Login required"
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        message: "Invalid session"
      });
    }

    /*
      Get the current user from the database.
      This guarantees that role comes from the
      current account rather than an outdated JWT.
    */
    const currentUser = await getUser(decoded.id);

    if (!currentUser) {
      return res.status(401).json({
        message: "User account not found"
      });
    }

    const role = normalizeRole(
      currentUser.role || decoded.role
    );

    if (!isValidRole(role)) {
      console.error(
        "AUTH ROLE ERROR:",
        currentUser.role
      );

      return res.status(403).json({
        message: "User role is invalid"
      });
    }

    /*
      Always use the current database role.
    */
    req.user = {
      ...decoded,
      id: currentUser.id,
      role,
      name: currentUser.name
    };

    next();
  } catch (error) {
    console.error(
      "AUTH ERROR:",
      error.message
    );

    return res.status(401).json({
      message: "Session expired. Login again."
    });
  }
}

/*
  Role middleware.

  All supplied roles are normalized before comparison.
  Therefore:
    worker
    WORKER
    Worker

  are treated as the same role.
*/
function roles(...allowed) {
  const normalizedAllowed = allowed
    .map(normalizeRole)
    .filter(Boolean);

  return (req, res, next) => {
    const userRole = normalizeRole(
      req.user?.role
    );

    console.log(
      "ROLE CHECK:",
      {
        userRole,
        allowedRoles: normalizedAllowed,
        path: req.originalUrl
      }
    );

    if (
      !userRole ||
      !normalizedAllowed.includes(userRole)
    ) {
      return res.status(403).json({
        message: "Role not allowed",
        role: userRole || null,
        allowed: normalizedAllowed
      });
    }

    next();
  };
}

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function haversine(a, b) {
  const R = 6371;

  const toRad = (d) =>
    (d * Math.PI) / 180;

  const dLat = toRad(
    Number(b.lat || 0) -
      Number(a.lat || 0)
  );

  const dLon = toRad(
    Number(b.lng || 0) -
      Number(a.lng || 0)
  );

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      toRad(Number(a.lat || 0))
    ) *
      Math.cos(
        toRad(Number(b.lat || 0))
      ) *
      Math.sin(dLon / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    )
  );
}

/* =========================================================
   SKILL MATCHING
========================================================= */

function skillMatchesService(
  worker,
  service
) {
  const skills = (
    worker.skills || []
  )
    .map(norm)
    .filter(Boolean);

  const name = norm(service?.name);
  const category = norm(
    service?.category
  );

  if (!skills.length) {
    return false;
  }

  const aliases = {
    electrician: [
      "electrician",
      "electrical",
      "electrical repair",
      "electrical installation"
    ],

    "electrical repair": [
      "electrician",
      "electrical",
      "electrical repair",
      "electrical installation"
    ],

    "electrical installation": [
      "electrician",
      "electrical",
      "electrical repair",
      "electrical installation"
    ],

    plumbing: [
      "plumbing",
      "plumber"
    ],

    plumber: [
      "plumbing",
      "plumber"
    ],

    carpentry: [
      "carpentry",
      "carpenter"
    ],

    carpenter: [
      "carpentry",
      "carpenter"
    ],

    painting: [
      "painting",
      "painter"
    ],

    painter: [
      "painting",
      "painter"
    ],

    cleaning: [
      "cleaning",
      "cleaner"
    ],

    cleaner: [
      "cleaning",
      "cleaner"
    ]
  };

  /* Direct matching */
  if (
    skills.some(
      (skill) =>
        skill === name ||
        skill.includes(name) ||
        name.includes(skill)
    )
  ) {
    return true;
  }

  /* Alias matching */
  for (const skill of skills) {
    const skillAliases =
      aliases[skill] || [];

    if (
      skillAliases.includes(name)
    ) {
      return true;
    }

    if (
      skillAliases.some(
        (alias) =>
          name.includes(alias) ||
          alias.includes(name)
      )
    ) {
      return true;
    }
  }

  /* Service-name word matching */
  const serviceWords = name
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 4 &&
        ![
          "repair",
          "service",
          "services"
        ].includes(word)
    );

  if (
    serviceWords.some((word) =>
      skills.some((skill) =>
        skill.includes(word)
      )
    )
  ) {
    return true;
  }

  /* Category matching */
  if (category) {
    if (
      skills.some(
        (skill) =>
          skill === category ||
          skill.includes(category) ||
          category.includes(skill)
      )
    ) {
      return true;
    }

    for (const skill of skills) {
      const skillAliases =
        aliases[skill] || [];

      if (
        skillAliases.includes(category)
      ) {
        return true;
      }
    }
  }

  return false;
}

/* =========================================================
   BOOKING HELPERS
========================================================= */

async function enrichBooking(
  booking
) {
  const worker = booking.worker_id
    ? await getWorker(
        booking.worker_id
      )
    : null;

  const customer =
    await getUser(
      booking.customer_id
    );

  return {
    id: booking.id,

    customerId:
      booking.customer_id,

    serviceId:
      booking.service_id,

    serviceName:
      booking.service_name,

    issue:
      booking.issue,

    scheduledAt:
      booking.scheduled_at,

    location:
      booking.location,

    emergency:
      booking.emergency,

    amount:
      Number(booking.amount || 0),

    status:
      booking.status,

    workerId:
      booking.worker_id,

    paymentId:
      booking.payment_id,

    timeline:
      booking.timeline || [],

    createdAt:
      booking.created_at,

    updatedAt:
      booking.updated_at,

    worker: worker
      ? {
          id: worker.id,
          userId: worker.user_id,
          name: worker.name,
          phone: worker.phone,
          skills: worker.skills,
          verified: worker.verified,
          rating: worker.rating,
          jobs: worker.jobs,
          workload: worker.workload,
          available: worker.available,
          location: worker.location
        }
      : null,

    customer:
      publicUser(customer)
  };
}

function addTimeline(
  booking,
  label
) {
  const timeline =
    Array.isArray(
      booking.timeline
    )
      ? [...booking.timeline]
      : [];

  timeline.push({
    label,
    at: new Date().toISOString()
  });

  return timeline;
}

/* =========================================================
   WORKER MATCHING
========================================================= */

async function eligibleWorkersForBooking(
  booking
) {
  const service =
    await getService(
      booking.service_id
    );

  if (
    !service ||
    service.active === false
  ) {
    console.log(
      "Service unavailable:",
      booking.service_id
    );

    return [];
  }

  const workers =
    await getWorkers();

  console.log(
    "========== WORKER MATCHING DEBUG =========="
  );

  console.log(
    "Booking:",
    booking.id
  );

  console.log(
    "Service:",
    service.name
  );

  console.log(
    "Service category:",
    service.category
  );

  console.log(
    "Total workers:",
    workers.length
  );

  const eligible =
    workers.filter(
      (worker) => {
        console.log(
          "\nWorker:",
          worker.name
        );

        console.log(
          "ID:",
          worker.id
        );

        console.log(
          "Verified:",
          worker.verified
        );

        console.log(
          "Available:",
          worker.available
        );

        console.log(
          "Workload:",
          worker.workload
        );

        console.log(
          "Skills:",
          worker.skills
        );

        if (
          worker.verified !== true
        ) {
          console.log(
            "Rejected: worker not verified"
          );

          return false;
        }

        if (
          worker.available !== true
        ) {
          console.log(
            "Rejected: worker not available"
          );

          return false;
        }

        if (
          Number(
            worker.workload || 0
          ) >= 1
        ) {
          console.log(
            "Rejected: worker workload >= 1"
          );

          return false;
        }

        if (
          !skillMatchesService(
            worker,
            service
          )
        ) {
          console.log(
            "Rejected: skill does not match service"
          );

          return false;
        }

        console.log(
          "WORKER ELIGIBLE"
        );

        return true;
      }
    );

  console.log(
    "========== ELIGIBLE WORKERS =========="
  );

  console.log(
    eligible.map(
      (worker) => ({
        id: worker.id,
        name: worker.name,
        skills: worker.skills,
        verified: worker.verified,
        available:
          worker.available,
        workload:
          worker.workload
      })
    )
  );

  return eligible
    .map((worker) => {
      const distance =
        worker.location &&
        booking.location
          ? haversine(
              booking.location,
              worker.location
            )
          : 0;

      const score =
        70 +
        Math.max(
          0,
          30 -
            Math.min(
              distance,
              10
            ) *
              3
        ) +
        Number(
          worker.rating || 0
        ) *
          5 +
        (booking.emergency
          ? Math.max(
              0,
              20 -
                Math.min(
                  distance,
                  5
                ) *
                  4
            )
          : 0);

      return {
        ...worker,

        distance:
          Number(
            distance.toFixed(2)
          ),

        skillMatch: true,

        score:
          Number(
            score.toFixed(1)
          )
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score
    );
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "sahakar-sewa-api",
      storage:
        "supabase",
      time:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   AUTH - REGISTER
========================================================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone,
        role,
        adminCode
      } = req.body;

      if (
        !name ||
        !email ||
        !password ||
        !role
      ) {
        return res.status(400).json({
          message:
            "Name, email, password and role are required"
        });
      }

      const normalizedRole =
        normalizeRole(role);

      if (
        !isValidRole(
          normalizedRole
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid role. Use customer, worker or admin."
        });
      }

      if (
        normalizedRole === "admin" &&
        adminCode !==
          ADMIN_SETUP_CODE
      ) {
        return res.status(403).json({
          message:
            "Administrator setup code is required"
        });
      }

      if (
        String(password).length < 6
      ) {
        return res.status(400).json({
          message:
            "Password must be at least 6 characters"
        });
      }

      const user =
        await createUser({
          name,
          email,
          password,
          phone,
          role:
            normalizedRole
        });

      if (
        normalizedRole ===
        "worker"
      ) {
        await createWorker({
          id: id("w"),

          userId:
            user.id,

          name:
            user.name,

          phone:
            user.phone,

          skills:
            req.body.skills ||
            [],

          documents:
            req.body.documents ||
            [],

          verified:
            false,

          verificationStatus:
            "pending",

          rating:
            0,

          jobs:
            0,

          workload:
            0,

          location:
            req.body.location ||
            null,

          available:
            false,

          cooperative:
            req.body.cooperative ||
            "",

          createdAt:
            new Date().toISOString()
        });
      }

      const token =
        tokenFor(user);

      return res
        .status(201)
        .json({
          token,

          user:
            publicUser(user),

          message:
            normalizedRole ===
            "worker"
              ? "Worker account created. Awaiting admin verification."
              : "Account created successfully."
        });
    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   AUTH - LOGIN
========================================================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          message:
            "Email and password are required"
        });
      }

      const user =
        await getUser(email);

      if (!user) {
        return res.status(401).json({
          message:
            "Invalid email or password"
        });
      }

      const validPassword =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!validPassword) {
        return res.status(401).json({
          message:
            "Invalid email or password"
        });
      }

      /*
        Normalize the role before returning
        the token.
      */
      user.role =
        normalizeRole(
          user.role
        );

      if (
        !isValidRole(
          user.role
        )
      ) {
        return res.status(403).json({
          message:
            "Your account has an invalid role. Contact administrator."
        });
      }

      return res.json({
        token:
          tokenFor(user),

        user:
          publicUser(user)
      });
    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        message:
          "Login failed"
      });
    }
  }
);

/* =========================================================
   AUTH - ME
========================================================= */

app.get(
  "/api/auth/me",
  auth,
  async (req, res) => {
    try {
      const user =
        await getUser(
          req.user.id
        );

      if (!user) {
        return res.status(404).json({
          message:
            "User not found"
        });
      }

      user.role =
        normalizeRole(
          user.role
        );

      res.json(
        publicUser(user)
      );
    } catch (error) {
      console.error(
        "AUTH ME ERROR:",
        error
      );

      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   SERVICES
========================================================= */

app.get(
  "/api/services",
  auth,
  async (req, res) => {
    try {
      const services =
        await getServices(true);

      res.json(
        services.map(
          (service) => ({
            id:
              service.id,

            name:
              service.name,

            category:
              service.category,

            description:
              service.description ||
              "",

            price:
              Number(
                service.price || 0
              ),

            icon:
              service.icon ||
              "🛠️",

            active:
              service.active,

            createdAt:
              service.created_at
          })
        )
      );
    } catch (error) {
      console.error(
        "SERVICES ERROR:",
        error
      );

      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

app.get(
  "/api/services/all",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const services =
        await getServices(false);

      res.json(services);
    } catch (error) {
      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

app.post(
  "/api/services",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const {
        name,
        category,
        description,
        price,
        icon
      } = req.body;

      if (
        !name ||
        !category
      ) {
        return res.status(400).json({
          message:
            "Service name and category are required"
        });
      }

      const service =
        await createService({
          id:
            id("s"),

          name:
            name.trim(),

          category:
            category
              .trim()
              .toLowerCase(),

          description:
            description || "",

          price:
            Number(
              price || 0
            ),

          icon:
            icon ||
            "🛠️",

          active:
            true,

          created_at:
            new Date().toISOString()
        });

      res
        .status(201)
        .json(service);
    } catch (error) {
      console.error(
        "CREATE SERVICE ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

app.patch(
  "/api/services/:id",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const existing =
        await getService(
          req.params.id
        );

      if (!existing) {
        return res.status(404).json({
          message:
            "Service not found"
        });
      }

      const updates = {
        ...req.body
      };

      if (
        updates.price !==
        undefined
      ) {
        updates.price =
          Number(
            updates.price
          );
      }

      const service =
        await updateService(
          req.params.id,
          updates
        );

      res.json(service);
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

app.delete(
  "/api/services/:id",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const service =
        await getService(
          req.params.id
        );

      if (!service) {
        return res.status(404).json({
          message:
            "Service not found"
        });
      }

      await updateService(
        req.params.id,
        {
          active: false
        }
      );

      res.json({
        message:
          "Service archived"
      });
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   WORKERS
========================================================= */

app.get(
  "/api/workers",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const workers =
        await getWorkers();

      res.json(workers);
    } catch (error) {
      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

app.get(
  "/api/workers/me",
  auth,
  roles("worker"),
  async (req, res) => {
    try {
      const worker =
        await getWorkerByUser(
          req.user.id
        );

      if (!worker) {
        return res.status(404).json({
          message:
            "Worker profile not found"
        });
      }

      res.json(worker);
    } catch (error) {
      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

app.post(
  "/api/workers/me/availability",
  auth,
  roles("worker"),
  async (req, res) => {
    try {
      const worker =
        await getWorkerByUser(
          req.user.id
        );

      if (!worker) {
        return res.status(404).json({
          message:
            "Worker profile not found"
        });
      }

      const available =
        !!req.body.available;

      if (
        !worker.verified &&
        available
      ) {
        return res.status(400).json({
          message:
            "You must be verified before becoming available."
        });
      }

      const updated =
        await updateWorker(
          worker.id,
          {
            available
          }
        );

      res.json(updated);
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

app.post(
  "/api/workers/me/location",
  auth,
  roles("worker"),
  async (req, res) => {
    try {
      const worker =
        await getWorkerByUser(
          req.user.id
        );

      if (!worker) {
        return res.status(404).json({
          message:
            "Worker profile not found"
        });
      }

      const lat =
        Number(req.body.lat);

      const lng =
        Number(req.body.lng);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return res.status(400).json({
          message:
            "Valid latitude and longitude are required"
        });
      }

      const updated =
        await updateWorker(
          worker.id,
          {
            location: {
              lat,
              lng
            }
          }
        );

      res.json(updated);
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

app.post(
  "/api/workers/:id/verify",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const worker =
        await getWorker(
          req.params.id
        );

      if (!worker) {
        return res.status(404).json({
          message:
            "Worker not found"
        });
      }

      const verified =
        !!req.body.verified;

      const updated =
        await updateWorker(
          worker.id,
          {
            verified,

            verification_status:
              verified
                ? "verified"
                : "rejected",

            available:
              verified
          }
        );

      res.json(updated);
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   BOOKINGS - GET
========================================================= */

app.get(
  "/api/bookings",
  auth,
  async (req, res) => {
    try {
      let bookings =
        await getBookings();

      /*
        CUSTOMER:
        Only their own bookings.
      */
      if (
        req.user.role ===
        "customer"
      ) {
        bookings =
          bookings.filter(
            (booking) =>
              booking.customer_id ===
              req.user.id
          );
      }

      /*
        WORKER:
        1. Already assigned bookings
        2. SEARCHING bookings matching worker
      */
      if (
        req.user.role ===
        "worker"
      ) {
        const worker =
          await getWorkerByUser(
            req.user.id
          );

        if (!worker) {
          return res.status(404).json({
            message:
              "Worker profile not found"
          });
        }

        const matchingBookings =
          [];

        for (
          const booking of bookings
        ) {
          /*
            Already assigned
          */
          if (
            booking.worker_id ===
            worker.id
          ) {
            matchingBookings.push(
              booking
            );

            continue;
          }

          /*
            Only SEARCHING bookings
          */
          if (
            booking.status !==
            "SEARCHING"
          ) {
            continue;
          }

          /*
            Worker verified
          */
          if (
            !worker.verified
          ) {
            continue;
          }

          /*
            Worker available
          */
          if (
            !worker.available
          ) {
            continue;
          }

          /*
            Worker not busy
          */
          if (
            Number(
              worker.workload || 0
            ) >= 1
          ) {
            continue;
          }

          const service =
            await getService(
              booking.service_id
            );

          if (!service) {
            continue;
          }

          if (
            !skillMatchesService(
              worker,
              service
            )
          ) {
            continue;
          }

          matchingBookings.push(
            booking
          );
        }

        bookings =
          matchingBookings;
      }

      const enriched = [];

      for (
        const booking of bookings
      ) {
        enriched.push(
          await enrichBooking(
            booking
          )
        );
      }

      res.json(enriched);
    } catch (error) {
      console.error(
        "GET BOOKINGS ERROR:",
        error
      );

      res.status(500).json({
        message:
          error.message ||
          "Failed to load bookings"
      });
    }
  }
);

/* =========================================================
   BOOKINGS - CREATE
========================================================= */

app.post(
  "/api/bookings",
  auth,
  roles("customer"),
  async (req, res) => {
    try {
      const {
        serviceId,
        issue,
        scheduledAt,
        location,
        emergency = false
      } = req.body;

      const customerId =
        req.user.id;

      if (!customerId) {
        return res.status(401).json({
          message:
            "Customer authentication information is missing"
        });
      }

      /*
        Check service
      */
      const {
        data: service,
        error: serviceError
      } = await supabase
        .from("services")
        .select("*")
        .eq("id", serviceId)
        .eq("active", true)
        .single();

      if (
        serviceError ||
        !service
      ) {
        console.error(
          "Service lookup error:",
          serviceError
        );

        return res.status(400).json({
          message:
            "Select a currently available service"
        });
      }

      if (
        !issue ||
        !String(issue).trim()
      ) {
        return res.status(400).json({
          message:
            "Issue is required"
        });
      }

      if (
        !location ||
        !location.address
      ) {
        return res.status(400).json({
          message:
            "Service address is required"
        });
      }

      console.log(
        "Creating booking for customer:",
        customerId
      );

      const {
        data: booking,
        error: bookingError
      } = await supabase
        .from("bookings")
        .insert({
          id: id("b"),

          customer_id:
            customerId,

          service_id:
            service.id,

          service_name:
            service.name,

          issue:
            String(issue).trim(),

          scheduled_at:
            scheduledAt || null,

          location: {
            address:
              location.address,

            lat:
              Number(
                location.lat || 0
              ),

            lng:
              Number(
                location.lng || 0
              )
          },

          emergency:
            Boolean(emergency),

          amount:
            Number(
              service.price || 0
            ),

          status:
            "SEARCHING",

          worker_id:
            null,

          payment_id:
            null,

          timeline: [
            {
              label:
                "Booking created",

              at:
                new Date().toISOString()
            }
          ]
        })
        .select("*")
        .single();

      if (bookingError) {
        console.error(
          "SUPABASE BOOKING ERROR:",
          bookingError
        );

        return res.status(400).json({
          message:
            bookingError.message
        });
      }

      console.log(
        "Booking created:",
        booking.id
      );

      res
        .status(201)
        .json(booking);
    } catch (error) {
      console.error(
        "BOOKING ERROR:",
        error
      );

      res.status(500).json({
        message:
          error.message ||
          "Failed to create booking"
      });
    }
  }
);

/* =========================================================
   MATCHING
========================================================= */

app.post(
  "/api/matching/recommendations",
  auth,
  roles(
    "customer",
    "admin"
  ),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.body.bookingId
        );

      if (!booking) {
        return res.status(404).json({
          message:
            "Booking not found"
        });
      }

      if (
        req.user.role ===
          "customer" &&
        booking.customer_id !==
          req.user.id
      ) {
        return res.status(403).json({
          message:
            "Not your booking"
        });
      }

      const service =
        await getService(
          booking.service_id
        );

      if (!service) {
        return res.status(400).json({
          message:
            "Service unavailable"
        });
      }

      const candidates =
        await eligibleWorkersForBooking(
          booking
        );

      res.json(
        candidates.slice(0, 10)
      );
    } catch (error) {
      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   ASSIGN WORKER
========================================================= */

app.post(
  "/api/bookings/:id/assign",
  auth,
  roles(
    "customer",
    "admin"
  ),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.params.id
        );

      const worker =
        await getWorker(
          req.body.workerId
        );

      if (
        !booking ||
        !worker
      ) {
        return res.status(404).json({
          message:
            "Booking or worker not found"
        });
      }

      if (
        req.user.role ===
          "customer" &&
        booking.customer_id !==
          req.user.id
      ) {
        return res.status(403).json({
          message:
            "Not your booking"
        });
      }

      if (
        !worker.verified ||
        !worker.available
      ) {
        return res.status(400).json({
          message:
            "Worker is not currently eligible for assignment"
        });
      }

      if (
        Number(
          worker.workload || 0
        ) >= 1
      ) {
        return res.status(400).json({
          message:
            "Worker is currently busy"
        });
      }

      if (booking.worker_id) {
        const oldWorker =
          await getWorker(
            booking.worker_id
          );

        if (oldWorker) {
          await updateWorker(
            oldWorker.id,
            {
              workload:
                Math.max(
                  0,
                  Number(
                    oldWorker.workload ||
                      0
                  ) - 1
                )
            }
          );
        }
      }

      const timeline =
        addTimeline(
          booking,
          `Assigned to ${worker.name}`
        );

      const updatedBooking =
        await updateBooking(
          booking.id,
          {
            worker_id:
              worker.id,

            status:
              "ASSIGNED",

            timeline,

            updated_at:
              new Date().toISOString()
          }
        );

      await updateWorker(
        worker.id,
        {
          workload:
            Number(
              worker.workload || 0
            ) + 1
        }
      );

      res.json(
        await enrichBooking(
          updatedBooking
        )
      );
    } catch (error) {
      console.error(
        "ASSIGN ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   WORKER RESPONSE
========================================================= */

app.post(
  "/api/bookings/:id/respond",
  auth,
  roles("worker"),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.params.id
        );

      const worker =
        await getWorkerByUser(
          req.user.id
        );

      if (
        !booking ||
        !worker ||
        booking.worker_id !==
          worker.id
      ) {
        return res.status(404).json({
          message:
            "Assignment not found"
        });
      }

      if (req.body.accepted) {
        const timeline =
          addTimeline(
            booking,
            "Worker accepted assignment"
          );

        const updated =
          await updateBooking(
            booking.id,
            {
              status:
                "ACCEPTED",

              timeline,

              updated_at:
                new Date().toISOString()
            }
          );

        return res.json(
          await enrichBooking(
            updated
          )
        );
      }

      const timeline =
        addTimeline(
          booking,
          "Worker rejected — ready for reassignment"
        );

      const updated =
        await updateBooking(
          booking.id,
          {
            status:
              "SEARCHING",

            worker_id:
              null,

            timeline,

            updated_at:
              new Date().toISOString()
          }
        );

      await updateWorker(
        worker.id,
        {
          workload:
            Math.max(
              0,
              Number(
                worker.workload || 0
              ) - 1
            )
        }
      );

      res.json(
        await enrichBooking(
          updated
        )
      );
    } catch (error) {
      console.error(
        "WORKER RESPONSE ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   SERVICE STATUS
========================================================= */

app.post(
  "/api/bookings/:id/status",
  auth,
  roles("worker"),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.params.id
        );

      const worker =
        await getWorkerByUser(
          req.user.id
        );

      const next =
        req.body.status;

      const allowed = [
        "ON_WAY",
        "ARRIVED",
        "IN_PROGRESS",
        "COMPLETED"
      ];

      if (
        !booking ||
        !worker ||
        booking.worker_id !==
          worker.id
      ) {
        return res.status(404).json({
          message:
            "Assignment not found"
        });
      }

      if (
        !allowed.includes(next)
      ) {
        return res.status(400).json({
          message:
            "Invalid status"
        });
      }

      const order = [
        "ACCEPTED",
        "ON_WAY",
        "ARRIVED",
        "IN_PROGRESS",
        "COMPLETED"
      ];

      const currentIndex =
        order.indexOf(
          booking.status
        );

      const nextIndex =
        order.indexOf(next);

      if (
        nextIndex !==
        currentIndex + 1
      ) {
        return res.status(400).json({
          message:
            `Next status must follow ${booking.status}`
        });
      }

      const timeline =
        addTimeline(
          booking,
          `Service status: ${next.replaceAll(
            "_",
            " "
          )}`
        );

      const updates = {
        status:
          next,

        timeline,

        updated_at:
          new Date().toISOString()
      };

      const updated =
        await updateBooking(
          booking.id,
          updates
        );

      if (
        next ===
        "COMPLETED"
      ) {
        await updateWorker(
          worker.id,
          {
            jobs:
              Number(
                worker.jobs || 0
              ) + 1,

            workload:
              Math.max(
                0,
                Number(
                  worker.workload ||
                    0
                ) - 1
              ),

            available:
              !!worker.verified
          }
        );
      }

      res.json(
        await enrichBooking(
          updated
        )
      );
    } catch (error) {
      console.error(
        "STATUS UPDATE ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   PAYMENTS
========================================================= */

app.post(
  "/api/bookings/:id/payment",
  auth,
  roles("customer"),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.params.id
        );

      if (
        !booking ||
        booking.customer_id !==
          req.user.id
      ) {
        return res.status(404).json({
          message:
            "Booking not found"
        });
      }

      if (
        ![
          "COMPLETED"
        ].includes(
          booking.status
        )
      ) {
        return res.status(400).json({
          message:
            `Payment is available after completion. Current status: ${booking.status}`
        });
      }

      if (
        booking.payment_id
      ) {
        return res.status(400).json({
          message:
            "Payment already recorded"
        });
      }

      const amount =
        Number(
          booking.amount || 0
        );

      const payment =
        await createPayment({
          id:
            id("p"),

          bookingId:
            booking.id,

          amount,

          method:
            req.body.method ||
            "UPI",

          status:
            "PAID",

          split: {
            worker:
              Number(
                (
                  amount *
                  0.8
                ).toFixed(2)
              ),

            cooperative:
              Number(
                (
                  amount *
                  0.15
                ).toFixed(2)
              ),

            welfare:
              Number(
                (
                  amount *
                  0.05
                ).toFixed(2)
              )
          },

          paidAt:
            new Date().toISOString()
        });

      const timeline =
        addTimeline(
          booking,
          "Payment recorded and settlement split calculated"
        );

      await updateBooking(
        booking.id,
        {
          payment_id:
            payment.id,

          status:
            "PAID",

          timeline,

          updated_at:
            new Date().toISOString()
        }
      );

      res.json(payment);
    } catch (error) {
      console.error(
        "PAYMENT ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   FEEDBACK
========================================================= */

app.post(
  "/api/bookings/:id/feedback",
  auth,
  roles("customer"),
  async (req, res) => {
    try {
      const booking =
        await getBooking(
          req.params.id
        );

      if (
        !booking ||
        booking.customer_id !==
          req.user.id
      ) {
        return res.status(404).json({
          message:
            "Booking not found"
        });
      }

      if (
        ![
          "COMPLETED",
          "PAID"
        ].includes(
          booking.status
        )
      ) {
        return res.status(400).json({
          message:
            "Feedback is available after service completion"
        });
      }

      const existing =
        await getFeedbackForBooking(
          booking.id
        );

      if (existing) {
        return res.status(400).json({
          message:
            "Feedback already submitted"
        });
      }

      const rating =
        Math.max(
          1,
          Math.min(
            5,
            Number(
              req.body.rating ||
                5
            )
          )
        );

      const feedback =
        await createFeedback({
          id:
            id("f"),

          bookingId:
            booking.id,

          customerId:
            req.user.id,

          workerId:
            booking.worker_id,

          rating,

          comment:
            req.body.comment ||
            "",

          createdAt:
            new Date().toISOString()
        });

      /*
        UPDATE WORKER RATING
      */
      if (
        booking.worker_id
      ) {
        const worker =
          await getWorker(
            booking.worker_id
          );

        if (worker) {
          const previousRating =
            Number(
              worker.rating || 0
            );

          const jobCount =
            Number(
              worker.jobs || 0
            );

          const newRating =
            jobCount > 0
              ? (
                  (
                    previousRating *
                    jobCount
                  ) +
                    rating
                ) /
                (jobCount + 1)
              : rating;

          await updateWorker(
            worker.id,
            {
              rating:
                Number(
                  newRating.toFixed(
                    2
                  )
                )
            }
          );
        }
      }

      const timeline =
        addTimeline(
          booking,
          `Customer feedback received: ${rating}/5`
        );

      await updateBooking(
        booking.id,
        {
          timeline,

          updated_at:
            new Date().toISOString()
        }
      );

      res.json(feedback);
    } catch (error) {
      console.error(
        "FEEDBACK ERROR:",
        error
      );

      res.status(400).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN OVERVIEW
========================================================= */

app.get(
  "/api/admin/overview",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const [
        usersResult,
        workers,
        services,
        bookings,
        payments
      ] = await Promise.all([
        supabase
          .from("users")
          .select(
            "id,role"
          ),

        getWorkers(),

        getServices(false),

        getBookings(),

        getPayments()
      ]);

      if (
        usersResult.error
      ) {
        throw new Error(
          usersResult.error
            .message
        );
      }

      const users =
        usersResult.data ||
        [];

      res.json({
        workers:
          workers.length,

        verifiedWorkers:
          workers.filter(
            (worker) =>
              worker.verified
          ).length,

        pendingWorkers:
          workers.filter(
            (worker) =>
              !worker.verified
          ).length,

        customers:
          users.filter(
            (user) =>
              normalizeRole(
                user.role
              ) ===
              "customer"
          ).length,

        admins:
          users.filter(
            (user) =>
              normalizeRole(
                user.role
              ) ===
              "admin"
          ).length,

        services:
          services.filter(
            (service) =>
              service.active !==
              false
          ).length,

        bookings:
          bookings.length,

        active:
          bookings.filter(
            (booking) =>
              ![
                "PAID",
                "COMPLETED",
                "CANCELLED"
              ].includes(
                booking.status
              )
          ).length,

        revenue:
          Number(
            payments
              .reduce(
                (
                  sum,
                  payment
                ) =>
                  sum +
                  Number(
                    payment.amount ||
                      0
                  ),
                0
              )
              .toFixed(2)
          ),

        emergency:
          bookings.filter(
            (booking) =>
              booking.emergency
          ).length
      });
    } catch (error) {
      console.error(
        "ADMIN OVERVIEW ERROR:",
        error
      );

      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN PAYMENTS
========================================================= */

app.get(
  "/api/admin/payments",
  auth,
  roles("admin"),
  async (req, res) => {
    try {
      const payments =
        await getPayments();

      res.json(payments);
    } catch (error) {
      res.status(500).json({
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   SUPABASE CONNECTION TEST
========================================================= */

app.get(
  "/api/test-supabase",
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("services")
        .select("id")
        .limit(1);

      if (error) {
        console.error(
          "Supabase test failed:",
          error
        );

        return res.status(500).json({
          ok: false,

          error:
            error.message
        });
      }

      res.json({
        ok: true,

        message:
          "Express connected to Supabase successfully",

        rows:
          data
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   PRODUCTION FRONTEND
========================================================= */

const clientDist =
  path.join(
    __dirname,
    "..",
    "client",
    "dist"
  );

if (
  process.env.NODE_ENV ===
    "production" ||
  fs.existsSync(
    clientDist
  )
) {
  app.use(
    express.static(
      clientDist
    )
  );

  app.get(
    "*",
    (req, res) => {
      res.sendFile(
        path.join(
          clientDist,
          "index.html"
        )
      );
    }
  );
}

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Sahakar Sewa API running on http://localhost:${PORT}`
    );

    console.log(
      "Storage: Supabase PostgreSQL"
    );

    console.log(
      "Role authentication: ENABLED"
    );
  }
);