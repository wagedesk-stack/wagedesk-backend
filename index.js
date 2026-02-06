import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import verifyToken from './middleware/verifyToken.js';
import supabase from './libs/supabaseClient.js';
import multer from 'multer'
import workspaceRouters from './routes/workspaceRoutes.js'

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer();

app.get('/', (req, res) => {
    res.send('WageDesk Backend is running!');
});

app.get('/api/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.status(200).json({ message: 'pong', time: new Date().toISOString() });
});

app.use('/api', workspaceRouters)


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Seever is running on port ${PORT}`);
});
