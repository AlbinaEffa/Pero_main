import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bcrypt from 'bcrypt';
import pkg from 'jsonwebtoken';
const { sign } = pkg;
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { db } from '../db/client.js';
import { authRateLimit } from '../app.js';
import { authenticateToken, type AuthedRequest } from '../middleware/auth.js';

// ── Input schemas ─────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email format')
    .max(254, 'Email is too long')
    .toLowerCase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  displayName: z.string().max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().min(1, 'Email is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

const router = express.Router();

// JWT_SECRET is validated at startup (index.ts + middleware/auth.ts); safe to assert here.
const JWT_SECRET = process.env.JWT_SECRET as string;

// REGISTRATION
router.post('/register', authRateLimit, async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Invalid input';
      return res.status(400).json({ error: msg });
    }
    const { email, password, displayName } = parsed.data;

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
router.post('/login', authRateLimit, async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Invalid input';
      return res.status(400).json({ error: msg });
    }
    const { email, password } = parsed.data;

    const userRecords = await db.select().from(users).where(eq(users.email, email));
    
    if (userRecords.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userRecords[0];

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

router.get('/me', authenticateToken, async (req: AuthedRequest, res) => {
  try {
    const userRecords = await db.select().from(users).where(eq(users.id, req.user.userId));
    if (userRecords.length === 0) return res.status(404).json({ error: 'User not found' });

    const { passwordHash: _ph, ...userWithoutPassword } = userRecords[0];
    void _ph;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /me — update display name
router.patch('/me', authenticateToken, async (req: AuthedRequest, res) => {
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

    const { passwordHash: _ph, ...userWithoutPassword } = updated;
    void _ph;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
