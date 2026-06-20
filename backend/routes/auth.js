const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { User, Boost } = models; // Note: Boost is not yet a separate model, handled via User or separate if needed

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, school, user_type, location, career_domain } = req.body;
    if (!name || !email || !password || !school || !user_type) {
      return res.status(400).json({ error: 'All primary fields are required' });
    }
    
    await initDB();
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const { v4: uuidv4 } = require('uuid');
    const uid = 'u_' + uuidv4().replace(/-/g, '').substring(0, 12);
    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      uid,
      name,
      email,
      password_hash: hash,
      school,
      user_type,
      location,
      career_domain,
      joined_at: Date.now()
    });

    const token = jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    // Convert to plain object and remove sensitive fields
    const userObj = user.toObject();
    delete userObj.password_hash;
    
    res.status(201).json({ token, user: userObj });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    await initDB();
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.is_banned) return res.status(403).json({ error: 'Account suspended' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uid: user.uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    const userObj = user.toObject();
    delete userObj.password_hash;

    res.json({ token, user: userObj });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing token' });
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    await initDB();
    const user = await User.findOne({ uid: payload.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Check streak
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yesterday = yest.toISOString().split('T')[0];
    
    let needsUpdate = false;
    if (user.last_active !== today) {
      if (user.last_active === yesterday) {
        user.streak++;
      } else if (user.last_active) {
        // Check shield boost (this part needs careful adaptation if Boosts are a separate collection)
        // For now, let's assume boosts are partially handled via User or we check a separate collection
        // Since I haven't made a Boost model yet, I'll stick to basic streak logic for now
        // TODO: Implement shield logic
        user.streak = 1;
      } else {
        user.streak = 1;
      }
      
      user.last_active = today;
      user.is_new = false;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await user.save();
    }

    const userObj = user.toObject();
    delete userObj.password_hash;

    res.json({ user: userObj });
  } catch (error) {
    console.error('Me error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
