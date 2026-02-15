// backend/controllers/payslipController.js
import supabase from '../libs/supabaseClient.js';
import { format } from 'date-fns';
import { generatePayslipPDF } from '../utils/payslipGenerator.js';
import { sendEmailService, getPayslipEmailTemplate } from '../services/brevo.js';

export const generatePayslipPdf = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;
  const { preview } = req.query;

  if (!payrollDetailId || !companyId) {
    return res.status(400).json({ error: 'Payroll detail ID and Company ID are required.' });
  }

  try {
    // Fetch payroll details with employee + payroll_run + company
    const { data: payrollData, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          last_name,
          other_names,
          krapin,
          nssf_number,
          shif_number
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            address,
            company_phone,
            company_email,
            logo_url
          )
        )
      `)
      .eq('id', payrollDetailId)
      .maybeSingle();

    if (error || !payrollData) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'Payslip data not found.' });
    }

    // Security: ensure payroll belongs to this company
    if (payrollData.payroll_run.company.id !== companyId) {
      return res.status(403).json({ error: 'This payslip does not belong to this company.' });
    }

    const { employee, payroll_run, ...details } = payrollData;
    const { company } = payroll_run;

    // Format month-year
    const formattedPeriod = `${payroll_run.payroll_month} ${payroll_run.payroll_year}`;

    // Generate PDF buffer using your utils generator
    const pdfBuffer = await generatePayslipPDF(details, formattedPeriod, company, employee);


    res.setHeader('Content-Type', 'application/pdf');

    // 2. Control the Content-Disposition header
    if (preview === 'true') {
        // This tells the browser to display the content inline (preview)
        res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"'); 
    } else {
        // This triggers a download box
        // Filename: Payslip_First_Last_Month_Year.pdf
        const fileName = `Payslip_${employee.first_name}_${employee.last_name}_${payroll_run.payroll_month}_${payroll_run.payroll_year}.pdf`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    res.send(pdfBuffer);

  } catch (err) {
    console.error('Error generating payslip:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

export const emailPayslip = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  if (!payrollDetailId || !companyId) {
    return res.status(400).json({ error: 'Payroll detail ID and Company ID are required.' });
  }

  try {
    // Fetch payroll details with employee, payroll_run, and company
    const { data: payrollData, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          last_name,
          email,
          other_names,
          krapin,
          nssf_number,
          shif_number
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            address,
            company_phone,
            company_email,
            logo_url
          )
        )
      `)
      .eq('id', payrollDetailId)
      .maybeSingle();

    if (error || !payrollData) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'Payslip data not found.' });
    }

    // Security: ensure payroll belongs to this company
    if (payrollData.payroll_run.company.id !== companyId) {
      return res.status(403).json({ error: 'This payslip does not belong to this company.' });
    }
    
    // Check if employee email exists
    if (!payrollData.employee.email) {
      return res.status(400).json({ error: 'Employee email address not found.' });
    }

    const { employee, payroll_run, ...details } = payrollData;
    const { company } = payroll_run;

    // Generate PDF buffer
    const formattedPeriod = `${payroll_run.payroll_month} ${payroll_run.payroll_year}`;
    const pdfBuffer = await generatePayslipPDF(details, formattedPeriod, company, employee);

    // Filename for attachment
    const fileName = `Payslip_${employee.first_name}_${employee.last_name}_${payroll_run.payroll_month}_${payroll_run.payroll_year}.pdf`;

    // Generate email template HTML
    const employeeFullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
    const htmlContent = getPayslipEmailTemplate(employeeFullName, company.business_name, formattedPeriod);

    // Send the email with the PDF as an attachment
    await sendEmail({
      to: employee.email,
      subject: `Your Payslip for ${formattedPeriod} from ${company.business_name}`,
      html: htmlContent,
      attachments: [{
        filename: fileName,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    
    res.status(200).json({ message: 'Payslip emailed successfully.' });

  } catch (err) {
    console.error('Error emailing payslip:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
