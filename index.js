import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import workspaceRouters from './routes/workspaceRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import companyUsersRoutes from './routes/companyUsersRoutes.js';
import bankRoutes from './routes/bankRoutes.js';
import employeesRoutes from './routes/employeesRoutes.js';
import allowanceRoutes from './routes/allowanceRoutes.js';
import deductionRoutes from './routes/deductionRoutes.js';
import deductionTypeRoutes from './routes/deductionTypeRoutes.js';
import allowanceTypeRoutes from './routes/allowanceTypeRoutes.js';
import companyReviewersRoutes from './routes/companyReviewersRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import payslipRoutes from './routes/payslipRoutes.js';
import p9aRoutes from './routes/p9aRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('WageDesk Backend is running!');
});

app.get('/api/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.status(200).json({ message: 'pong', time: new Date().toISOString() });
});

app.use('/api', workspaceRouters)
app.use('/api', bankRoutes)

app.use('/api/company/:companyId/payroll/runs', reportsRoutes);
app.use('/api/company/:companyId', payrollRoutes);
app.use('/api/company/:companyId/payroll/payslip', payslipRoutes);
app.use('/api/company/:companyId/employees', p9aRoutes);
app.use('/api/company', employeesRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/company', companyUsersRoutes);
app.use('/api/company', allowanceTypeRoutes);
app.use('/api/company', allowanceRoutes);
app.use('/api/company', deductionTypeRoutes);
app.use('/api/company', deductionRoutes);
app.use('/api/company', companyReviewersRoutes);



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
