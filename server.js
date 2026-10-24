const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');

const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-development-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','rto','police'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_no TEXT NOT NULL,
    owner_name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS challans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL,
    violation TEXT NOT NULL, fine REAL NOT NULL, status TEXT DEFAULT 'UNPAID',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
  )`);
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const hash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex');
    db.run('INSERT OR IGNORE INTO users(username,password_hash,role) VALUES(?,?,?)',
      [process.env.ADMIN_USERNAME, hash, 'admin']);
  }
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) return res.redirect('/login');
    next();
  };
}
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.get('/', (req, res) => res.render('index', { user: req.session.user }));
app.get('/login', (req, res) => res.render('login', { error: '' }));
app.post('/login', (req, res) => {
  db.get('SELECT id,username,role,password_hash FROM users WHERE username=?',
    [req.body.username], (err, user) => {
      if (err || !user || user.password_hash !== hashPassword(req.body.password || '')) {
        return res.status(401).render('login', { error: 'Invalid credentials' });
      }
      req.session.user = { id: user.id, username: user.username, role: user.role };
      res.redirect('/dashboard');
    });
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect('/' + req.session.user.role);
});
app.get('/admin', requireRole('admin'), (req, res) => res.render('admin', { user: req.session.user, message: '' }));
app.post('/admin/create-user', requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['rto','police'].includes(role)) {
    return res.status(400).render('admin', { user: req.session.user, message: 'Provide username, password, and a valid role.' });
  }
  db.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
    [username.trim(), hashPassword(password), role], function (err) {
      res.render('admin', { user: req.session.user, message: err ? 'Could not create user; username may already exist.' : 'User created.' });
    });
});

app.get('/rto', requireRole('rto','admin'), (req, res) => res.render('rto', { user: req.session.user, message: '', qr: null }));
app.post('/rto/vehicle', requireRole('rto','admin'), (req, res) => {
  const vehicleNo = (req.body.vehicle_no || '').trim().toUpperCase();
  const ownerName = (req.body.owner_name || '').trim();
  if (!vehicleNo || !ownerName) return res.status(400).render('rto', { user: req.session.user, message: 'All fields are required.', qr: null });
  db.run('INSERT INTO vehicles(vehicle_no,owner_name) VALUES(?,?)', [vehicleNo, ownerName], async function (err) {
    if (err) return res.status(500).render('rto', { user: req.session.user, message: 'Database error.', qr: null });
    const publicUrl = `${req.protocol}://${req.get('host')}/public/vehicle/${this.lastID}`;
    const qr = await QRCode.toDataURL(publicUrl);
    res.render('rto', { user: req.session.user, message: `Vehicle record ${this.lastID} created.`, qr });
  });
});

app.get('/police', requireRole('police','admin'), (req, res) => res.render('police', { user: req.session.user, message: '' }));
app.post('/police/challan', requireRole('police','admin'), (req, res) => {
  const vehicleNo = (req.body.vehicle_no || '').trim().toUpperCase();
  const violation = (req.body.violation || '').trim();
  const fine = Number(req.body.fine);
  if (!vehicleNo || !violation || !Number.isFinite(fine) || fine <= 0) {
    return res.status(400).render('police', { user: req.session.user, message: 'Enter a vehicle number, violation, and positive fine.' });
  }
  db.get('SELECT id FROM vehicles WHERE vehicle_no=?', [vehicleNo], (err, vehicle) => {
    if (err || !vehicle) return res.status(404).render('police', { user: req.session.user, message: 'Vehicle not found. Register it through the RTO module first.' });
    db.run('INSERT INTO challans(vehicle_id,violation,fine) VALUES(?,?,?)',
      [vehicle.id, violation, fine], function (e) {
        res.render('police', { user: req.session.user, message: e ? 'Could not create challan.' : `Challan #${this.lastID} created.` });
      });
  });
});

app.get('/public', (req, res) => res.render('public', { results: null, error: '' }));
app.post('/public/search', (req, res) => {
  const q = (req.body.query || '').trim();
  db.all(`SELECT c.id AS challan_id, v.vehicle_no, v.owner_name, c.violation, c.fine, c.status, c.created_at
          FROM challans c JOIN vehicles v ON v.id=c.vehicle_id
          WHERE v.vehicle_no LIKE ? OR CAST(c.id AS TEXT)=? ORDER BY c.id DESC`,
    [`%${q}%`, q], (err, results) => res.render('public', { results: err ? [] : results, error: err ? 'Search failed.' : '' }));
});
app.get('/public/vehicle/:id', (req, res) => {
  db.all(`SELECT c.id AS challan_id, v.vehicle_no, v.owner_name, c.violation, c.fine, c.status, c.created_at
          FROM vehicles v LEFT JOIN challans c ON c.vehicle_id=v.id WHERE v.id=?`,
    [req.params.id], (err, results) => res.render('public', { results: err ? [] : results, error: err ? 'Lookup failed.' : '' }));
});

app.use((req, res) => res.status(404).send('Page not found'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`QR Nexus running at http://localhost:${port}`));
