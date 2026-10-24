# QR Nexus – Digital Challan System 🚦

QR Nexus is a web-based academic prototype for creating digital challan records and connecting them to QR codes. The supplied Design Thinking & Societal Research report describes role-based Admin/RTO/Police flows and a public challan lookup experience, using Node.js, Express, EJS, SQLite, and QR code generation.

## Modules
- Admin: create official RTO and Police accounts
- RTO: enter vehicle details and generate a QR-linked record
- Police: look up a record and issue a challan
- Public: search and view challan details

## Tech Stack
Node.js, Express, EJS, SQLite, `qrcode`, HTML/CSS (Tailwind CDN in views).

## Setup
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Demo Accounts
For safety, the application does not ship with real government accounts. Create an admin account via the seed instructions in `README-SETUP.md` and use test data only.

## Limitations
This is an educational prototype and is not connected to Telangana RTO, police systems, government identity services, or a payment gateway. Do not use it to issue real challans or store real personal data.
