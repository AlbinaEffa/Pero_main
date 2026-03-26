import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bcrypt from 'bcrypt';
import pkg from 'jsonwebtoken';
const { sign, verify } = pkg;
import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { db } from '../db/client.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'pero_super_secret_key_change_me_in_prod';

// REGISTRATION
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existingUsers = await db.select().from(users).where(eq(users.email, email));
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const newUser = await db.insert(users).values({
      email,
      passwordHash,
      displayName: displayName || null
    }).returning();

    const user = newUser[0];
    const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const userRecords = await db.select().from(users).where(eq(users.email, email));
    
    if (userRecords.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userRecords[0];
    
    // @ts-ignore - passwordHash will be added to schema
    const match = await bcrypt.compare(password, user.passwordHash || '');
    
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET CURRENT USER Middleware
export const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

router.get('/me', authenticateToken, async (req: any, res) => {
  try {
    const userRecords = await db.select().from(users).where(eq(users.id, req.user.userId));
    if (userRecords.length === 0) return res.status(404).json({ error: 'User not found' });

    const { passwordHash, ...userWithoutPassword } = userRecords[0] as any;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /me — update display name
router.patch('/me', authenticateToken, async (req: any, res) => {
  try {
    const { displayName } = req.body;
    if (displayName === undefined) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    const [updated] = await db
      .update(users)
      .set({ displayName: displayName?.trim() || null })
      .where(eq(users.id, req.user.userId))
      .returning();

    const { passwordHash, ...userWithoutPassword } = updated as any;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
