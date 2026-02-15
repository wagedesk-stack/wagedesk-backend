// backend/controllers/p9aController.js
import supabase from '../libs/supabaseClient.js';
import { generateP9APDF } from '../utils/p9aGenerator.js';
import { sendEmailService, getP9AEmailTemplate } from '../services/brevo.js';

export const generateP9APdf = async (req, res) => {
  const { companyId, employeeId, year } = req.params;
  const { preview } = req.query;

  if (!companyId || !employeeId || !year) {
    return res.status(400).json({ error: 'Company ID, Employee ID, and Year are required.' });
  }

  try {
    // Fetch all payroll details for the given employee and year
    const { data: payrollData, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          first_name,
          last_name,
          other_names,
          krapin,
          employee_number
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            kra_pin
          )
        )
      `)
      .eq('employee_id', employeeId)
      .eq('payroll_run.payroll_year', year); // Filter by the year from the payroll_run table

    if (error || !payrollData || payrollData.length === 0) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'P9A data not found for the specified employee and year.' });
    }

    // Security: ensure the first record belongs to the correct company
    const firstRecord = payrollData[0];
    if (firstRecord.payroll_run.company.id !== companyId) {
      return res.status(403).json({ error: 'This P9A report does not belong to this company.' });
    }

    // Generate PDF buffer using the utility generator
    const pdfBuffer = await generateP9APDF(payrollData, firstRecord.employee, firstRecord.payroll_run.company, year);

    // 1. Set the correct MIME type
    res.setHeader('Content-Type', 'application/pdf');

    // 2. Control the Content-Disposition header
    if (preview === 'true') {
        // This tells the browser to display the content inline (preview)
        res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"'); 
    } else {
        // This triggers a download box
            // Filename: P9A_First_Last_Year.pdf
        const fileName = `P9A_${firstRecord.employee.first_name}_${firstRecord.employee.last_name}_${year}.pdf`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating P9A PDF:', error);
    res.status(500).json({ error: 'Failed to generate P9A PDF.' });
  }
};

export const emailP9A = async (req, res) => {
    const { companyId, employeeId, year } = req.params;

    if (!companyId || !employeeId || !year) {
        return res.status(400).json({ error: 'Company ID, Employee ID, and Year are required.' });
    }

    try {
        // Fetch all payroll details for the given employee and year
        const { data: payrollData, error } = await supabase
            .from('payroll_details')
            .select(`
                *,
                employee:employee_id (
                    id,
                    first_name,
                    last_name,
                    other_names,
                    krapin,
                    employee_number,
                    email
                ),
                payroll_run:payroll_run_id (
                    payroll_month,
                    payroll_year,
                    company:company_id (
                        id,
                        business_name,
                        kra_pin
                    )
                )
            `)
            .eq('employee_id', employeeId)
            .eq('payroll_run.payroll_year', year);

        if (error || !payrollData || payrollData.length === 0) {
            console.error('Supabase fetch error:', error);
            return res.status(404).json({ error: 'P9A data not found for the specified employee and year.' });
        }
        
        // Security: ensure the first record belongs to the correct company
        const firstRecord = payrollData[0];
        if (firstRecord.payroll_run.company.id !== companyId) {
          return res.status(403).json({ error: 'This P9A report does not belong to this company.' });
        }
    
        // Check if employee email exists
        if (!firstRecord.employee.email) {
            return res.status(400).json({ error: 'Employee email address not found.' });
        }
    
        // Generate PDF buffer using the utility generator
        const pdfBuffer = await generateP9APDF(payrollData, firstRecord.employee, firstRecord.payroll_run.company, year);
    
        // Filename for attachment
        const fileName = `P9A_${firstRecord.employee.first_name}_${firstRecord.employee.last_name}_${year}.pdf`;
    
        // Generate email template HTML (you need to create this function)
        const employeeFullName = `${firstRecord.employee.first_name || ''} ${firstRecord.employee.last_name || ''}`.trim();
        // Assuming you'll create a new email template function for P9A
        const htmlContent = getP9AEmailTemplate(employeeFullName, firstRecord.payroll_run.company.business_name, year);
    
        // Send the email with the PDF as an attachment
        await sendEmail({
            to: firstRecord.employee.email,
            subject: `Your P9A Tax Card for the year ${year} from ${firstRecord.payroll_run.company.business_name}`,
            html: htmlContent,
            attachments: [{
                filename: fileName,
                content: pdfBuffer,
                contentType: 'application/pdf',
            }],
        });
    
        res.status(200).json({ message: 'P9A emailed successfully.' });
    
    } catch (err) {
        console.error('Error emailing P9A:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
};
