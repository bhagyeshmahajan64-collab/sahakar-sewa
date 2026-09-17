# Sahakar Sewa — Real-User Full-Stack Prototype

Sahakar Sewa is a modular service-request and worker-matching platform designed to connect customers with verified service workers.

The prototype supports real user registration, authentication, service requests, worker verification, intelligent worker matching, booking assignment, service-status tracking, payment recording, customer feedback, and administrator management.

The current implementation uses:

- React.js + Vite for the web frontend
- Node.js + Express.js for the backend API
- Supabase PostgreSQL for persistent application data
- JWT-based authentication
- Role-based authorization for customers, workers, and administrators

The application is designed as a practical hackathon-ready prototype and can be extended toward a production deployment.

---

## Features

### Authentication

- Customer registration and login
- Worker registration and login
- Administrator registration protected by `ADMIN_SETUP_CODE`
- JWT-based authentication
- Session validation
- Role-based API authorization
- Protected routes

### Customer

Customers can:

- Create an account
- Log in securely
- View available services
- Create service bookings
- Enter the service issue
- Provide a service address
- Provide location coordinates
- Mark a booking as emergency
- View booking status
- View assigned worker information
- Track the service timeline
- Make payment after service completion
- Submit feedback and rating

### Worker

Workers can:

- Register an account
- Provide skills and worker information
- Submit onboarding information
- Wait for administrator verification
- Become available after verification
- Update their location
- Receive eligible booking assignments
- Accept assignments
- Reject assignments
- Update service status
- Complete assigned services
- Build job history
- Receive customer ratings

### Administrator

Administrators can:

- Register using the administrator setup code
- Log in securely
- View system overview
- View workers
- Verify or reject workers
- View services
- Create services
- Update services
- Archive services
- View bookings
- View payment information
- Monitor system statistics

### Worker Matching

The matching system considers:

- Worker verification status
- Worker availability
- Worker workload
- Worker skills
- Requested service
- Service category
- Worker location
- Booking location
- Distance
- Worker rating
- Emergency booking priority

Eligible workers are calculated and returned as recommendations.

### Booking Workflow

The implemented booking lifecycle is:

```text
Customer creates booking
        ↓
SEARCHING
        ↓
Worker assigned
        ↓
ASSIGNED
        ↓
Worker accepts
        ↓
ACCEPTED
        ↓
ON_WAY
        ↓
ARRIVED
        ↓
IN_PROGRESS
        ↓
COMPLETED
        ↓
Customer payment
        ↓
PAID
        ↓
Customer feedback