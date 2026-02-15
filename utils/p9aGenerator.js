// backend/utils/p9aGenerator.js
import PdfPrinter from "pdfmake";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

// Helper to get the directory name in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always resolve relative to project root (backend/)
const projectRoot = path.resolve(__dirname, "..");
const fontsDir = path.join(projectRoot, "fonts");

// Debug log
console.log("Looking for fonts in:", fontsDir);

// Safety check
if (!fs.existsSync(fontsDir)) {
  console.error("❌ Fonts folder not found at:", fontsDir);
}

function formatCurrency(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === null || num === undefined) return "0.00";
  return num.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const generateP9APDF = (monthlyPayrollData, employee, company, year) => {
  return new Promise(async (resolve, reject) => {
    try {
      const fonts = {
        Georgia: {
          normal: path.join(fontsDir, "Georgia.TTF"),
          bold: path.join(fontsDir, "Georgia-Bold.TTF"),
          italics: path.join(fontsDir, "Georgia-Italic.TTF"),
          bolditalics: path.join(fontsDir, "Georgia-BoldItalic.TTF"),
        },
      };

      const printer = new PdfPrinter(fonts);

      // Ensure logo exists
      const logoPath = path.join(projectRoot, "assets", "images", "kra_logo.png");
      let logo = null;
      if (fs.existsSync(logoPath)) {
        logo = logoPath;
      }
      else {
        console.warn("⚠️ KRA logo not found at:", logoPath);
      }

      // --- Header ---
      const headerContent = [
        {
          image: logo || "assets/images/placeholder_logo.png",
          width: 250,
          alignment: "center",
          margin: [0, 5, 0, 5],
        },
        {
          text: "ISO 9001:2015 CERTIFIED",
          style: "header",
          fontSize: 8,
          alignment: "center",
        },
        {
          text: `KENYA REVENUE AUTHORITY DOMESTIC TAXES DEPARTMENT TAX DEDUCTION CARD YEAR ${year}`,
          fontSize: 9,
          style: "header",
        },
        {
          columns: [{ text: "APPENDIX 2A", style: "kra", alignment: "left" }],
        },
        {
          columns: [
            [
              {
                text: `Employer's Name: ${company.business_name || "N/A"}`,
                style: "info",
              },
              {
                text: `Employee's Main Name: ${employee.last_name}`,
                style: "info",
              },
              {
                text: `Employee's Other Names: ${employee.first_name} ${
                  employee.other_names || ""
                }`,
                style: "info",
              },
            ],
            [
              {
                text: `Employer's PIN: ${company.kra_pin || "N/A"}`,
                style: "info",
                alignment: "right",
              },
              {
                text: `Employee's PIN: ${employee.krapin || "N/A"}`,
                style: "info",
                alignment: "right",
              },
            ],
          ],
          margin: [0, 10, 0, 10],
        },
      ];

      // --- Months list ---
      const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      const sortedData = monthlyPayrollData.sort(
        (a, b) =>
          months.indexOf(a.payroll_run.payroll_month) -
          months.indexOf(b.payroll_run.payroll_month)
      );

      // --- Totals accumulator ---
      let totals = {
        salary: 0,
        benefits: 0,
        gross: 0,
        e1: 0,
        e2: 0,
        e3: 0,
        f: 0,
        g: 0,
        h: 0,
        i: 0,
        j: 0,
        k: 0,
        l: 0,
        m_p: 0,
        n: 0,
        o: 0,
      };

      // --- Table header rows ---
      const tableBody = [
        [
          { text: "MONTH", rowSpan: 2, style: "tableHeader" },
          { text: "Basic\nSalary", rowSpan: 1, style: "tableHeader" },
          { text: "Benefits-\nNonCash", rowSpan: 1, style: "tableHeader" },
          { text: "Value of\nQuarters", rowSpan: 1, style: "tableHeader" },
          { text: "Total Gross\nPay", rowSpan: 1, style: "tableHeader" },
          {
            text: "Defined Contribution Retirement\nScheme",
            colSpan: 3,
            style: "tableHeader",
          },
          {},
          {},
          {
            text: "Affordable\nHousing Levy\n(AHL)",
            rowSpan: 1,
            style: "tableHeader",
          },
          {
            text: "Social Health\nInsurance\nFund (SHIF)",
            rowSpan: 1,
            style: "tableHeader",
          },
          {
            text: "Post\nRetirement\nMedical Fund\n(PRMF)",
            rowSpan: 1,
            style: "tableHeader",
          },
          {
            text: "Owner\nOccupied\nInterest",
            rowSpan: 1,
            style: "tableHeader",
          },
          {
            text: "Total Deductions\n(Lower of E\n+F+G+H+I",
            rowSpan: 1,
            style: "tableHeader",
          },
          { text: "Chargeable\nPay (D-J)", rowSpan: 1, style: "tableHeader" },
          { text: "Tax Charged", rowSpan: 1, style: "tableHeader" },
          { text: "Personal\nRelief", rowSpan: 1, style: "tableHeader" },
          { text: "Insurance\nRelief", rowSpan: 1, style: "tableHeader" },
          { text: "PAYE Tax\n(L-M-N) Kshs.", rowSpan: 1, style: "tableHeader" },
        ],
        [
          {},
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", colSpan: 3, style: "tableHeader" },
          {},
          {},
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Kshs.", rowSpan: 1, style: "tableHeader" },
        ],
        [
          {},
          { text: "A", rowSpan: 1, style: "tableHeader" },
          { text: "B", rowSpan: 1, style: "tableHeader" },
          { text: "C", rowSpan: 1, style: "tableHeader" },
          { text: "D", rowSpan: 1, style: "tableHeader" },
          { text: "E", colSpan: 3, style: "tableHeader" },
          {},
          {},
          { text: "F", rowSpan: 1, style: "tableHeader" },
          { text: "G", rowSpan: 1, style: "tableHeader" },
          { text: "H", rowSpan: 1, style: "tableHeader" },
          { text: "I", rowSpan: 1, style: "tableHeader" },
          { text: "J", rowSpan: 1, style: "tableHeader" },
          { text: "K", rowSpan: 1, style: "tableHeader" },
          { text: "L", rowSpan: 1, style: "tableHeader" },
          { text: "M", rowSpan: 1, style: "tableHeader" },
          { text: "N", rowSpan: 1, style: "tableHeader" },
          { text: "0", rowSpan: 1, style: "tableHeader" },
        ],
        [
          {},
          {},
          {},
          {},
          {},
          { text: "E1\n30% of A", style: "tableHeader" },
          { text: "E2\nActual", style: "tableHeader" },
          { text: "E3\nFixed\n30,000 p.m", style: "tableHeader" },
          {},
          {},
          {},
          {},
          {},
          {},
          {},
          {},
          {},
          {},
        ],
      ];

      // --- Table data rows ---
      sortedData.forEach((m) => {
        const salary = m.basic_salary || 0;
        const benefits = m.total_non_cash_benefits + m.total_allowances || 0;
        const gross = m.gross_pay || 0;
        const e1 = salary * 0.3;
        const e2 = m.nssf_deduction || 0;
        const e3 = 30000;
        const f = m.housing_levy_deduction || 0;
        const g = m.shif_deduction || 0;
        const h = 0;
        const i = 0;
        const j = Math.min(e1, e2, e3) + f + g + h + i;
        const k = gross - j || 0;
        const l = m.paye_tax + 2400 || 0;
        const m_p = 2400;
        const n = m.insurance_relief || 0;
        const o = l - m_p - n;

        totals.salary += salary;
        totals.benefits += benefits;
        totals.gross += gross;
        totals.e1 += e1;
        totals.e2 += e2;
        totals.e3 += e3;
        totals.f += f;
        totals.g += g;
        totals.h += h;
        totals.i += i;
        totals.j += j;
        totals.k += k;
        totals.l += l;
        totals.m_p += m_p;
        totals.n += n;
        totals.o += o;

        tableBody.push([
          {
            text: m.payroll_run.payroll_month.toUpperCase(),
            alignment: "left",
          },
          { text: formatCurrency(salary), alignment: "right" },
          { text: formatCurrency(benefits), alignment: "right" },
          { text: "0.00", alignment: "right" },
          { text: formatCurrency(gross), alignment: "right" },
          { text: formatCurrency(e1), alignment: "right" },
          { text: formatCurrency(e2), alignment: "right" },
          { text: formatCurrency(e3), alignment: "right" },
          { text: formatCurrency(f), alignment: "right" },
          { text: formatCurrency(g), alignment: "right" },
          { text: formatCurrency(h), alignment: "right" },
          { text: formatCurrency(i), alignment: "right" },
          { text: formatCurrency(j), alignment: "right" },
          { text: formatCurrency(k), alignment: "right" },
          { text: formatCurrency(l), alignment: "right" },
          { text: formatCurrency(m_p), alignment: "right" },
          { text: formatCurrency(n), alignment: "right" },
          { text: formatCurrency(o), alignment: "right" },
        ]);
      });

      // Totals row
      tableBody.push([
        { text: "TOTALS", bold: true, alignment: "left" },
        { text: formatCurrency(totals.salary), bold: true, alignment: "right" },
        {
          text: formatCurrency(totals.benefits),
          bold: true,
          alignment: "right",
        },
        { text: "0.00", bold: true, alignment: "right" },
        { text: formatCurrency(totals.gross), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e1), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e2), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e3), bold: true, alignment: "right" },
        { text: formatCurrency(totals.f), bold: true, alignment: "right" },
        { text: formatCurrency(totals.g), bold: true, alignment: "right" },
        { text: formatCurrency(totals.h), bold: true, alignment: "right" },
        { text: formatCurrency(totals.i), bold: true, alignment: "right" },
        { text: formatCurrency(totals.j), bold: true, alignment: "right" },
        { text: formatCurrency(totals.k), bold: true, alignment: "right" },
        { text: formatCurrency(totals.l), bold: true, alignment: "right" },
        { text: formatCurrency(totals.m_p), bold: true, alignment: "right" },
        { text: formatCurrency(totals.n), bold: true, alignment: "right" },
        { text: formatCurrency(totals.o), bold: true, alignment: "right" },
      ]);

      // --- End of year section ---
      const endOfYear = {
        columns: [
          [
            {
              text: "To be completed by Employer at end of year",
              fontSize: 7,
              bold: true,
              margin: [0, 0, 0, 2],
            },
            {
              text: `TOTAL CHARGEABLE PAY (COL. K) Kshs. ${formatCurrency(
                totals.k
              )}`,
              fontSize: 7,
              bold: true,
              margin: [0, 0, 0, 2],
            },
            {
              text: "IMPORTANT",
              bold: true,
              fontSize: 7,
              margin: [0, 1, 0, 1],
            },
            {
              text: "1. Use P9A",
              fontSize: 6,
              margin: [0, 1, 0, 1],
            },
            {
              ul: [
                "(a) For all liable employees and where director/employee received Benefits in addition to cash emoluments",
                "(b) Where an employee is eligible to deduction on owner occupier interest.",
                "(c) Where an employee contributes to a post retirement medical fund",
              ],
              fontSize: 6,
              lineHeight: 0.9,
              margin: [0, 1, 0, 1],
            },
            {
              text: "2.",
              fontSize: 6,
              margin: [0, 1, 0, 1],
            },
            {
              ul: [
                "(a) Deductible interest in respect of any month prior to December 2024 must not exceed Kshs. 25,000/= and commencing December 2024 must not exceed 30,000/=",
                "(b) Deductible pension contribution in respect of any month prior to December 2024 must not exceed Kshs. 20,000/= and commencing December 2024 must not exceed 30,000/=",
                "(c) Deductible contribution to a post retirement medical fund in respect of any month is effective from December 2024, must not exceed Kshs.15,000/=",
                "(d) Deductible Contribution to the Social Health Insurance Fund (SHIF) and deductions made towards Affordable Housing Levy (AHL) are effective December 2024",
                "(e) Personal Relief is Kshs. 2400 per Month or 28,800 per year",
                "(f) Insurance Relief is 15% of the Premium up to a Maximum of Kshs. 5,000 per month or Kshs. 60,000 per year",
              ],
              fontSize: 6,
              lineHeight: 0.9,
              margin: [0, 1, 0, 1],
            },
            {
              text: "P9A",
              fontSize: 7,
              bold: true,
              margin: [0, 2, 0, 0],
            },
          ],
          [
            {
              text: `TOTAL TAX (COL. O) Kshs. ${formatCurrency(totals.o)}`,
              fontSize: 7,
              bold: true,
              margin: [0, 0, 0, 2],
            },
            {
              text: "c) Attach",
              fontSize: 6,
              margin: [0, 2, 0, 1],
            },
            {
              ul: [
                "(i) Photostat copy of interest certificate and statement of account from the Financial Institution",
                "(ii) The DECLARATION duly signed by the employee.",
              ],
              fontSize: 6,
              lineHeight: 0.9,
            },
          ],
        ],
      };

      // --- Doc Definition ---
      const docDefinition = {
        pageOrientation: "landscape",
        pageSize: "A4",
        //pageMargins: [20, 30, 20, 30],
        defaultStyle: { font: "Georgia" },
        content: [
          ...headerContent,
          {
            table: {
              headerRows: 4,
              body: tableBody,
              widths: ["auto", ...Array(17).fill("*")],
            },
            fontSize: 5,
            layout: {
              hLineWidth: () => 0.25,
              vLineWidth: () => 0.25,
              hLineColor: () => "black",
              vLineColor: () => "black",
            },
            alignment: "center",
          },
          { text: "\n" },
          endOfYear,
        ],
        columnGap: 0,
        alignment: "center",
        styles: {
          title: { fontSize: 16, bold: true },
          kra: { fontSize: 9, bold: true },
          header: { fontSize: 11, bold: true, alignment: "center" },
          subheader: { fontSize: 9, bold: true, margin: [0, 5, 0, 5] },
          info: { fontSize: 8, margin: [0, 1, 0, 1] },
          small: { fontSize: 7 },
          tableHeader: {
            bold: true,
            alignment: "center",
            margin: [0, 1, 0, 1],
          },
        },
      };

      // Generate PDF
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on("data", (chunk) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.end();
    } catch (err) {
      console.error("Error generating P9A PDF:", err);
      reject(err);
    }
  });
};
