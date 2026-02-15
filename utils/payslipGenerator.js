// backend/utils/payslipGenerator.js
import PDFDocument from 'pdfkit';
import fetch from 'node-fetch';

function formatCurrency(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === null || num === undefined) return '0.00';
  return num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function drawSectionHeader(doc, text, y, x, width) {
  doc.font('Helvetica-Bold').fontSize(9.5).text(text.toUpperCase(), x, y, {
    width: width,
    align: 'left',
  });
  const newY = y + doc.currentLineHeight() + 1;
  doc.moveTo(x, newY - 2)
    .lineTo(x + width, newY - 2)
    .lineWidth(0.3)
    .strokeColor('#555555')
    .stroke();
  return newY + 3;
}

function drawLineItem(doc, label, value, y, labelX, contentWidth, isBold = false) {
  const valueWidth = 80;
  const valueX = doc.page.margins.left + contentWidth - valueWidth;
  const labelWidthMax = contentWidth - valueWidth - 10;

  doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
  doc.text(label, labelX, y, {
    width: labelWidthMax,
    align: 'left',
    lineBreak: false,
  });

  const actualLabelWidth = doc.widthOfString(label);
  const dotsStartX = labelX + actualLabelWidth + 2;
  const dotsEndX = valueX - 2;
  if (dotsEndX > dotsStartX) {
    let dots = '.'.repeat(
      Math.floor((dotsEndX - dotsStartX) / doc.widthOfString('.'))
    );
    doc.font('Helvetica')
      .fontSize(8.5)
      .fillColor('#c0c0c0')
      .text(dots, dotsStartX, y, {
        width: dotsEndX - dotsStartX,
        align: 'left',
        lineBreak: false,
      })
      .fillColor('black');
  }

  doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(8.5)
    .text(String(value), valueX, y, { width: valueWidth, align: 'right' });

  return y + doc.currentLineHeight() + 1;
}

export async function generatePayslipPDF(detail, formattedPayrollMonth, companyDetails, employeeData) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margins: { top: 25, bottom: 25, left: 28, right: 28 },
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const companyName = companyDetails?.business_name || 'YOUR COMPANY';
    const employeeFullName = `${employeeData.first_name || ''} ${employeeData.other_names || ''} ${employeeData.last_name || ''}`.trim();
    const personal_relief = 2400.00;
    const gross_tax = detail.paye_tax + personal_relief || 0.00;
    const allowable_deductions = detail.total_statutory_deductions - detail.paye_tax || 0.00;
    //const total_gross_pay = detail.gross_pay || 0.00;

    const margin = doc.page.margins.left;
    const contentWidth = doc.page.width - margin * 2;
    let currentY = doc.page.margins.top;

    // --- Logo (top-right) ---
    let logoHeight = 0;
    if (companyDetails?.logo_url) {
      try {
        const logoResponse = await fetch(companyDetails.logo_url);
        if (logoResponse.ok) {
          const logoBuffer = await logoResponse.buffer();

          // place logo at top-right
      const logoWidth = 50; // smaller size
      const logoX = doc.page.width - doc.page.margins.right - logoWidth;
      const logoY = currentY; // aligns with header top

      doc.image(logoBuffer, logoX, logoY, { width: logoWidth }); // scaled logo
      logoHeight = 50;
        }
      } catch (e) {
        console.error('Logo fetch error:', e);
      }
    }

    // --- Header ---
    doc.font('Helvetica-Bold').fontSize(13).text(companyName.toUpperCase(), 0, currentY, { align: 'center' });
    currentY += doc.currentLineHeight() * 1.1;
    doc.font('Helvetica-Bold').fontSize(11).text('PAYSLIP', { align: 'center' });
    currentY += doc.currentLineHeight() * 0.8;
    // move "Printed on" just below logo
const printedY = Math.max(currentY, logoHeight + doc.page.margins.top + 5);
    doc.font('Helvetica').fontSize(7).text(
      `PRINTED ON ${new Date().toLocaleDateString('en-GB').toUpperCase()}`,
      0, printedY,
      { align: 'right' }
    );

    currentY = printedY + doc.currentLineHeight() * 1.8;

    // --- Employee Details ---
    const empLineHeight = 10;
    const empLabelWidth = 80;
    const empDetails = [
      { label: 'EMPLOYEE NO:', value: employeeData.employee_number || '-' },
      { label: 'NAME:', value: employeeFullName },
      { label: 'KRA PIN:', value: employeeData.krapin || '-' },
      { label: 'NSSF NO:', value: employeeData.nssf_number || '-' },
      { label: 'SHIF NO:', value: employeeData.shif_number || '-' },
      { label: 'PERIOD:', value: formattedPayrollMonth.toUpperCase() },
    ];
    empDetails.forEach((item) => {
      doc.font('Helvetica-Bold').fontSize(7.5).text(item.label, margin, currentY);
      doc.font('Helvetica').fontSize(7.5).text(item.value, margin + empLabelWidth, currentY);
      currentY += empLineHeight;
    });
    currentY += empLineHeight * 0.8;

    // --- EARNINGS ---
    currentY = drawSectionHeader(doc, 'EARNINGS', currentY, margin, contentWidth);
    currentY = drawLineItem(doc, 'Basic Pay', formatCurrency(detail.basic_salary), currentY, margin, contentWidth);

    if (detail.allowances_details) {
      try {
        const allowances = Array.isArray(detail.allowances_details)
          ? detail.allowances_details
          : JSON.parse(detail.allowances_details);

        allowances.forEach((allowance) => {
          if (parseFloat(allowance.value) > 0) {
            currentY = drawLineItem(doc, allowance.name, formatCurrency(allowance.value), currentY, margin, contentWidth);
          }
        });
      } catch (err) {
        console.error('Invalid allowances_details JSON', err);
      }
    }

    currentY = drawLineItem(doc, 'GROSS PAY', formatCurrency(detail.gross_pay), currentY, margin, contentWidth, true);
    currentY += empLineHeight * 1.2;

    // --- TAXATION ---
    currentY = drawSectionHeader(doc, 'TAXATION', currentY, margin, contentWidth);
    if (detail.nssf_deduction) {
      currentY = drawLineItem(doc, 'PEN. Relief (INCL. NSSF)', formatCurrency(detail.nssf_deduction), currentY, margin, contentWidth);
    }
    if (detail.taxable_income) {
      currentY = drawLineItem(doc, 'Taxable Pay', formatCurrency(detail.taxable_income), currentY, margin, contentWidth, true);
    }
    if (allowable_deductions) {
      currentY = drawLineItem(doc, 'Allowable Deductions', formatCurrency(allowable_deductions), currentY, margin, contentWidth);
    }
    if (gross_tax) {
      currentY = drawLineItem(doc, 'Gross Tax', formatCurrency(gross_tax), currentY, margin, contentWidth);
    }
    if (personal_relief) {
      currentY = drawLineItem(doc, 'Monthly Personal Relief', formatCurrency(personal_relief), currentY, margin, contentWidth);
    }
    if (detail.insurance_relief) {
      currentY = drawLineItem(doc, 'Insurance Relief', formatCurrency(detail.insurance_relief), currentY, margin, contentWidth);
    }
    currentY += empLineHeight * 1.2;

    // --- DEDUCTIONS ---
    currentY = drawSectionHeader(doc, 'DEDUCTIONS', currentY, margin, contentWidth);
    currentY = drawLineItem(doc, 'PAYE', formatCurrency(detail.paye_tax), currentY, margin, contentWidth);
    if (parseFloat(detail.nssf_tier1_deduction) > 0) {
      currentY = drawLineItem(doc, 'NSSF Tier I', formatCurrency(detail.nssf_tier1_deduction), currentY, margin, contentWidth);
    }
    if (parseFloat(detail.nssf_tier2_deduction) > 0) {
      currentY = drawLineItem(doc, 'NSSF Tier II', formatCurrency(detail.nssf_tier2_deduction), currentY, margin, contentWidth);
    }
    currentY = drawLineItem(doc, 'SHIF', formatCurrency(detail.shif_deduction), currentY, margin, contentWidth);
    currentY = drawLineItem(doc, 'Housing Levy', formatCurrency(detail.housing_levy_deduction), currentY, margin, contentWidth);
    if (parseFloat(detail.helb_deduction) > 0) {
      currentY = drawLineItem(doc, 'Student Loan(HELB)', formatCurrency(detail.helb_deduction), currentY, margin, contentWidth);
    }

    if (detail.deductions_details) {
      try {
        const deductions = Array.isArray(detail.deductions_details)
          ? detail.deductions_details
          : JSON.parse(detail.deductions_details);

        deductions.forEach((deduction) => {
          if (parseFloat(deduction.value) > 0) {
            currentY = drawLineItem(doc, deduction.name, formatCurrency(deduction.value), currentY, margin, contentWidth);
          }
        });
      } catch (err) {
        console.error('Invalid deductions_details JSON', err);
      }
    }

    currentY = drawLineItem(doc, 'TOTAL DEDUCTIONS', formatCurrency(detail.total_deductions), currentY, margin, contentWidth, true);
    currentY += empLineHeight * 1.2;

    // --- NET PAY ---
    currentY = drawLineItem(doc, 'NET PAY', formatCurrency(detail.net_pay), currentY, margin, contentWidth, true);
    currentY += empLineHeight * 2;

    // --- PAYMENT DETAILS ---
    currentY = drawSectionHeader(doc, 'PAYMENT DETAILS', currentY, margin, contentWidth);
    doc.font('Helvetica').fontSize(8).text('Pay Mode:', margin, currentY);
    doc.font('Helvetica-Bold').fontSize(8).text((detail.payment_method || '-').toUpperCase(), margin + 70, currentY);
    currentY += empLineHeight;

    if (detail.payment_method?.toLowerCase().includes('bank')) {
      doc.font('Helvetica').fontSize(8).text('Bank / Acc No:', margin, currentY);
      doc.font('Helvetica').fontSize(8).text(`${detail.bank_name || '-'} / ${detail.account_name || '-'}`, margin + 70, currentY);
    } else if (detail.payment_method?.toLowerCase().includes('mpesa')) {
      doc.font('Helvetica').fontSize(8).text('M-Pesa No:', margin, currentY);
      doc.font('Helvetica').fontSize(8).text(detail.mpesa_phone || '-', margin + 70, currentY);
    }

    doc.end();
  });
}
