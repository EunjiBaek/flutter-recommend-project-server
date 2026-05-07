const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const authMiddleware = require('../middleare/authMiddleware');

const router = express.Router();

// 회원가입
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: '이메일과 비밀번호를 입력해주세요.',
      });
    }

    const [existingUsers] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);

    if (existingUsers.length > 0) {
      return res.status(409).json({
        message: '이미 가입된 이메일입니다.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
      email,
      hashedPassword,
    ]);

    return res.status(201).json({
      message: '회원가입 성공',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 로그인
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: '이메일과 비밀번호를 입력해주세요.',
      });
    }

    const [rows] = await pool.execute(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      [email],
    );

    if (rows.length === 0) {
      return res.status(401).json({
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    return res.json({
      message: '로그인 성공',
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: '서버 오류가 발생했습니다.',
    });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  return res.json({
    user: req.user,
  });
});

module.exports = router;
