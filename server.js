const dotenv = require('dotenv');

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';

dotenv.config({ path: envFile });

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

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
