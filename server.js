const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({
    path: process.env.NODE_ENV === 'development' ? '.env.development' : '.env',
  });
}

const express = require('express');
const cors = require('cors');

console.log(process.env.NODE_ENV);

const authRoutes = require('./routes/auth');
const retaurantsRoutes = require('./routes/restaurants');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/restaurants', retaurantsRoutes);

app.get('/', (req, res) => {
  res.send('Auth server running');
});

app.get('/db-test', async (req, res) => {
  const [rows] = await pool.query('SELECT 1 AS result');
  res.json(rows);
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
