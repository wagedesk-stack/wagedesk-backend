// backend/controllers/reportsController.js
import supabase from "../libs/supabaseClient.js";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// Helper function to filter payroll details that are fully approved
const filterFullyApprovedEmployees = async (payrollData, companyId, runId) => {
  try {
    // Get all reviewers for this company with their levels
    const { data: allReviewers, error: reviewersError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId);

    if (reviewersError) {
      console.error("Error fetching reviewers:", reviewersError);
      return payrollData; // Fallback to return all data if error
    }

    // Separate reviewers by level
    const level1Reviewers = allReviewers?.filter(r => r.reviewer_level === 1) || [];
    const level2Reviewers = allReviewers?.filter(r => r.reviewer_level === 2) || [];
    
    // If no level 1 or 2 reviewers, consider all employees as approved
    if (level1Reviewers.length === 0 && level2Reviewers.length === 0) {
      return payrollData;
    }

    // Get all payroll_detail_ids from the payrollData
    const payrollDetailIds = payrollData.map((item) => item.id);

    if (payrollDetailIds.length === 0) return payrollData;

     // Get all reviews for these payroll details with reviewer level info
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select(`
        payroll_detail_id, 
        status,
        company_reviewers (
          reviewer_level
        )
      `)
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) {
      console.error("Error fetching reviews:", reviewsError);
      return payrollData;
    }

    // Group reviews by payroll_detail_id and by level
    const reviewsByDetail = {};
    reviews.forEach((review) => {
      const detailId = review.payroll_detail_id;
      const level = review.company_reviewers?.reviewer_level;
      
      if (!reviewsByDetail[detailId]) {
        reviewsByDetail[detailId] = {
          level1: [],
          level2: [],
          all: []
        };
      }
      
      // Only consider level 1 and 2 reviewers
      if (level === 1) {
        reviewsByDetail[detailId].level1.push(review.status);
      } else if (level === 2) {
        reviewsByDetail[detailId].level2.push(review.status);
      }
      
      reviewsByDetail[detailId].all.push(review);
    });

     // Filter payroll data to only include employees approved by level 1 and 2
    const approvedData = payrollData.filter((detail) => {
      const detailReviews = reviewsByDetail[detail.id];
      
      // If no reviews for this detail, it's not approved
      if (!detailReviews) return false;

      // Check for any rejections from level 1 or 2
      const hasLevel1Rejection = detailReviews.level1.some(status => status === "REJECTED");
      const hasLevel2Rejection = detailReviews.level2.some(status => status === "REJECTED");
      
      if (hasLevel1Rejection || hasLevel2Rejection) return false;

      // Check if all level 1 reviewers have approved
      const allLevel1Approved = level1Reviewers.length > 0 
        ? detailReviews.level1.length === level1Reviewers.length && 
          detailReviews.level1.every(status => status === "APPROVED")
        : true; // If no level 1 reviewers, consider it satisfied
      
      // Check if all level 2 reviewers have approved
      const allLevel2Approved = level2Reviewers.length > 0
        ? detailReviews.level2.length === level2Reviewers.length && 
          detailReviews.level2.every(status => status === "APPROVED")
        : true; // If no level 2 reviewers, consider it satisfied

      return allLevel1Approved && allLevel2Approved;
    });

    console.log(
      `Filtered ${payrollData.length} records to ${approvedData.length} employees approved by level 1 and 2 reviewers`,
    );
    return approvedData;
  } catch (error) {
    console.error("Error in filterFullyApprovedEmployees:", error);
    return payrollData; // Fallback to return all data on error
  }
};

// Helper function to get all completed payroll runs for a year
const fetchAnnualRunIds = async (companyId, year) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("id, payroll_month")
    .eq("company_id", companyId)
    .eq("payroll_year", year)
    .in("status", ["APPROVED", "LOCKED", "PAID"]); // Only approved runs should be included in the annual report

  if (error) {
    throw new Error("Failed to fetch annual payroll runs.");
  }
  return data;
};

// Helper function to get annual gross pay data
const fetchAnnualGrossPayData = async (runIds, companyId) => {
  const runIdList = runIds.map((run) => run.id); // extract only IDs
  if (runIdList.length === 0) return [];

  const { data, error } = await supabase
    .from("payroll_details")
    .select(
      `
                gross_pay,id,
                employee:employee_id (employee_number, first_name, last_name, middle_name),
                payroll_run:payroll_run_id (payroll_month, id)
            `,
    )
    .in("payroll_run_id", runIdList);

  if (error) {
    console.error("Supabase error fetching gross pay details:", error);
    throw new Error("Failed to fetch annual gross pay details.");
  }

  // If no data, return empty array
  if (!data || data.length === 0) return [];

  // Get all payroll_detail_ids
  const payrollDetailIds = data.map((item) => item.id);

  // Get all reviews for these payroll details with reviewer level info
  const { data: reviews, error: reviewsError } = await supabase
    .from("payroll_reviews")
    .select(`
      payroll_detail_id, 
      status,
      company_reviewers (
        reviewer_level
      )
    `)
    .in("payroll_detail_id", payrollDetailIds);

  if (reviewsError) {
    console.error("Error fetching reviews for annual data:", reviewsError);
    return data; // Fallback to return all data
  }

  // Get all reviewers for this company with their levels
  const { data: allReviewers } = await supabase
    .from("company_reviewers")
    .select("id, reviewer_level")
    .eq("company_id", companyId);

  // Separate reviewers by level
  const level1Reviewers = allReviewers?.filter(r => r.reviewer_level === 1) || [];
  const level2Reviewers = allReviewers?.filter(r => r.reviewer_level === 2) || [];

  // If no level 1 or 2 reviewers, return all data
  if (level1Reviewers.length === 0 && level2Reviewers.length === 0) {
    return data;
  }


   // Group reviews by payroll_detail_id and by level
  const reviewsByDetail = {};
  reviews.forEach((review) => {
    const detailId = review.payroll_detail_id;
    const level = review.company_reviewers?.reviewer_level;
    
    if (!reviewsByDetail[detailId]) {
      reviewsByDetail[detailId] = {
        level1: [],
        level2: []
      };
    }
    
    // Only consider level 1 and 2 reviewers
    if (level === 1) {
      reviewsByDetail[detailId].level1.push(review.status);
    } else if (level === 2) {
      reviewsByDetail[detailId].level2.push(review.status);
    }
  });

 // Filter data to only include employees approved by level 1 and 2
  const approvedData = data.filter((detail) => {
    const detailReviews = reviewsByDetail[detail.id];
    
    // If no reviews for this detail, it's not approved
    if (!detailReviews) return false;

    // Check for any rejections from level 1 or 2
    const hasLevel1Rejection = detailReviews.level1.some(status => status === "REJECTED");
    const hasLevel2Rejection = detailReviews.level2.some(status => status === "REJECTED");
    
    if (hasLevel1Rejection || hasLevel2Rejection) return false;

    // Check if all level 1 reviewers have approved
    const allLevel1Approved = level1Reviewers.length > 0 
      ? detailReviews.level1.length === level1Reviewers.length && 
        detailReviews.level1.every(status => status === "APPROVED")
      : true; // If no level 1 reviewers, consider it satisfied
    
    // Check if all level 2 reviewers have approved
    const allLevel2Approved = level2Reviewers.length > 0
      ? detailReviews.level2.length === level2Reviewers.length && 
        detailReviews.level2.every(status => status === "APPROVED")
      : true; // If no level 2 reviewers, consider it satisfied

    return allLevel1Approved && allLevel2Approved;
  });

  return approvedData;
};

// Helper function to fetch payroll details for a given run
const fetchPayrollData = async (companyId, runId) => {
  const { data, error } = await supabase
    .from("payroll_details")
    .select(
      `
            *,
            employee:employee_id (
                first_name,
                last_name,
                middle_name,
                phone,
                email,
                gender,
                date_of_birth,
                employee_number,
                krapin,
                nssf_number,
                shif_number,
                id_number,
                citizenship,
                employee_type,
                has_disability,
                hire_date,
                marital_status
            ),
            payroll_run:payroll_run_id (
                payroll_number
            )
        `,
    )
    .eq("payroll_run_id", runId);

  if (error) {
    throw new Error("Failed to fetch payroll data.");
  }

  // Security check: ensure the payroll run belongs to the company
  const { data: runData, error: runError } = await supabase
    .from("payroll_runs")
    .select("company_id")
    .eq("id", runId)
    .single();
  if (runError || runData.company_id !== companyId) {
    throw new Error("Unauthorized access to payroll run.");
  }

  // Filter to only include fully approved employees
  const approvedData = await filterFullyApprovedEmployees(
    data,
    companyId,
    runId,
  );

  return approvedData;
};

// Helper function to fetch company details
const fetchCompanyDetails = async (companyId) => {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  if (error) {
    throw new Error("Failed to fetch company details.");
  }
  return data;
};

//Get Available Years for Annual Report
export const getAnnualReportYears = async (req, res) => {
  //console.log("Debug code");
  try {
    const { companyId } = req.params;

    if (!companyId) {
      return res
        .status(400)
        .json({ error: "Company ID is missing in request parameters." });
    }

    // Fetch unique payroll years where the payroll run is 'Completed'
   const { data, error } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .in("status", ["APPROVED", "LOCKED", "PAID"]); // Only approved runs are useful for the annual report

    if (error) {
      console.error("Error fetching annual report years:", error);
      return res
        .status(500)
        .json({ error: "Database query failed to fetch available years." });
    }

    // Handle case with no runs
    if (!data || data.length === 0) {
      return res.status(200).json([]);
    }

    // Extract unique years and sort them descending (latest first)
    const uniqueYears = [
      ...new Set(data.map((item) => item.payroll_year)),
    ].sort((a, b) => b - a);

    // FIX: Return a clean JSON array of numbers, not an object.
    // This resolves the 500 error caused by the frontend expecting the wrong format.
    res.status(200).json(uniqueYears);
  } catch (error) {
    //console.log("Debug code");
    console.error("getAnnualReportYears error:", error.message);
    res.status(500).json({
      error:
        error.message &&
        "Internal server error while fetching available years.",
    });
  }
};

//Generate Annual Gross Pay Report (Excel)
export const generateAnnualGrossEarningsReport = async (req, res) => {
  const { companyId } = req.params;
  const { year, download } = req.query;

  if (!year) {
    return res.status(400).json({ error: "Missing year parameter." });
  }

  // --- Helper to set the disposition header
  const getDisposition = (filename, isDownload) => {
    const dispositionType =
      isDownload === "true" || isDownload === undefined
        ? "attachment"
        : "inline";
    return `${dispositionType}; filename="${filename}"`;
  };

  try {
    // 1. Fetch Company Info (for header)
    const { data: companyData } = await supabase
      .from("companies")
      .select("business_name, location, company_phone, company_email, logo_url")
      .eq("id", companyId)
      .single();

    const companyInfo = companyData || {};

    // 2. Payroll Data
    const runData = await fetchAnnualRunIds(companyId, parseInt(year));
    if (runData.length === 0)
      return res
        .status(404)
        .json({ error: "No completed payroll runs found for that year." });

    const rawData = await fetchAnnualGrossPayData(runData, companyId);

    // 3. Transform Data
    const employeeMap = {};
    const MONTHS = [
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

    rawData.forEach((record) => {
      // Use employee_number for a stable key
      const empId = record.employee.employee_number;
      const fullName = `${record.employee.first_name} ${
        record.employee.last_name
      } ${record.employee.middle_name || ""}`.trim();
      if (!employeeMap[empId]) {
        employeeMap[empId] = {
          "EMP. CODE": empId,
          NAME: fullName,
          Total: 0,
        };
        MONTHS.forEach((m) => (employeeMap[empId][m] = 0));
      }

      const month = record.payroll_run.payroll_month;
      const gross = parseFloat(record.gross_pay) || 0;

      // Only update if the month is valid
      if (MONTHS.includes(month)) {
        employeeMap[empId][month] = gross;
        employeeMap[empId].Total += gross;
      }
    });

    const reportData = Object.values(employeeMap).sort((a, b) => {
      // Logic to robustly compare alphanumeric employee codes
      const codeA = a["EMP. CODE"] || "";
      const codeB = b["EMP. CODE"] || "";
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    // 4. Generate Excel Report using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Annual Gross Earnings ${year}`);

    //  --------- Header Section (Row 1-5) ------------

    // 1. Merge cells for the header section
    sheet.mergeCells("A1:O5");

    // 2. Combine all header text into a single value for the merged cell A1
    const mainTitle = `ANNUAL GROSS EARNINGS: ${year}`;

    // Set the value of the merged cell. Use newlines for formatting.
    const mergedCell = sheet.getCell("A1");
    mergedCell.value = `${
      companyInfo?.business_name?.toUpperCase() || "YOUR COMPANY"
    }\n${mainTitle}`;

    // Apply styles to the merged cell
    mergedCell.font = {
      bold: true,
      size: 14,
    };
    mergedCell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    mergedCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFFFF" }, // White background
    };
    mergedCell.border = {
      top: { style: "none" },
      left: { style: "none" },
      bottom: { style: "none" },
      right: { style: "none" },
    };

    // 🧭 Styles
    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    };
    const borderStyle = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };

    // 🧾 A. HEADER AREA (Logo + Company Info)
    const logoUrl = companyInfo?.logo_url;
    if (logoUrl) {
      try {
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.buffer();
        const logoImage = workbook.addImage({
          buffer: logoBuffer,
          extension: "jpeg",
        });
        sheet.addImage(logoImage, {
          tl: { col: 1, row: 1 },
          ext: { width: 60, height: 60 },
        });
      } catch (error) {
        console.error("Failed to add logo:", error);
      }
    }

    // 🧮 B. Table Headers
    const startRow = 6;
    const headers = [
      "EMP. CODE",
      "NAME",
      ...MONTHS.map((m) => m.slice(0, 3).toUpperCase()),
      "TOTAL",
    ];
    const headerRow = sheet.getRow(startRow);
    headerRow.values = headers;
    headerRow.font = { bold: true };
    headerRow.fill = headerFill;
    headerRow.alignment = { horizontal: "center" };
    headerRow.border = borderStyle;

    // Define column widths
    sheet.columns = [
      { width: 12 },
      { width: 25 },
      ...Array(12).fill({ width: 14 }),
      { width: 16 },
    ];

    // C. Employee Rows
    let rowIndex = startRow + 1;
    for (const emp of reportData) {
      const row = sheet.getRow(rowIndex);
      const vals = [
        emp["EMP. CODE"],
        emp.NAME,
        ...MONTHS.map((m) => emp[m]),
        emp.Total,
      ];
      row.values = vals;
      row.alignment = { horizontal: "right" };
      row.getCell(2).alignment = { horizontal: "left" }; // Name column left-aligned
      row.border = borderStyle;
      row.eachCell((cell, col) => {
        if (col > 2) cell.numFmt = "#,##0.00";
      });
      rowIndex++;
    }

    // 🧮 D. Totals Row
    //BLANK ROW
    rowIndex++;

    const totalRow = sheet.getRow(rowIndex);
    totalRow.getCell(1).value = "TOTALS";
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: "right" };
    totalRow.border = borderStyle;

    // Calculate SUM for each month + Total
    for (let i = 3; i <= headers.length; i++) {
      const colLetter = sheet.getColumn(i).letter;
      totalRow.getCell(i).value = {
        formula: `SUM(${colLetter}${startRow + 1}:${colLetter}${rowIndex - 1})`,
      };
      totalRow.getCell(i).numFmt = "#,##0.00";
      totalRow.getCell(i).font = { bold: true };
    }

    // 🕒 Footer
    const footerRowIndex = rowIndex + 2;
    sheet.mergeCells(`A${footerRowIndex}:D${footerRowIndex}`);
    sheet.getCell(`A${footerRowIndex}`).value =
      `Printed on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    sheet.getCell(`A${footerRowIndex}`).font = { italic: true, size: 9 };

    // 5. Send to client
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      getDisposition(`Annual_Gross_Earnings_${year}.xlsx`, download),
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating annual gross earnings report:", error);
    res.status(500).json({ error: "Failed to generate annual report." });
  }
};

// Helper functions for each file type here
export const generateReport = async (req, res) => {
  const { companyId, runId, reportType } = req.params;
  const { download } = req.query;

  if (!companyId || !runId || !reportType) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  // --- Helper to set the disposition header
  const getDisposition = (filename, isDownload) => {
    const dispositionType =
      isDownload === "true" || isDownload === undefined
        ? "attachment"
        : "inline";
    return `${dispositionType}; filename="${filename}"`;
  };

  try {
    const payrollData = await fetchPayrollData(companyId, runId);
    let companyDetails;
    if (reportType === "payroll-summary") {
      companyDetails = await fetchCompanyDetails(companyId);
    }

    switch (reportType) {
      case "kra-sec-b1":
        // Call KRA file generation logic
        const kraCsv = await generateKraSecB1(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          getDisposition(`KRA_SEC_B1_${runId}.csv`, download),
        );
        res.end(Buffer.from(kraCsv, "utf-8"));
        break;
      case "nssf-return":
        // Call NSSF file generation logic
        const nssfExcelBuffer = await generateNssfReturn(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`NSSF_Return_${runId}.xlsx`, download),
        );
        res.send(nssfExcelBuffer);
        break;
      case "shif-return":
        const shifExcelBuffer = await generateShifReturn(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`SHIF_Return_${runId}.xlsx`, download),
        );
        res.send(shifExcelBuffer);
        break;
      case "housing-levy-return":
        const housingLevyCsv = await generateHousingLevyReturn(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Housing_Levy_${runId}.csv`, download),
        );
        res.end(Buffer.from(housingLevyCsv, "utf-8"));
        break;
      case "helb-report":
        const helbExcelBuffer = await generateHelbReport(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`HELB_Report_${runId}.xlsx`, download),
        );
        res.send(helbExcelBuffer);
        break;
      case "bank-payment":
        const companyDetails = await fetchCompanyDetails(companyId);
        const bankCsv = await generateBankPaymentFile(
          payrollData,
          companyDetails,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Bank_Payments_${runId}.csv`, download),
        );
        res.end(Buffer.from(bankCsv, "utf-8"));
        break;
      case "mpesa-payment":
        const mpesaCsv = await generateMpesaPaymentFile(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          getDisposition(`M-Pesa_Payments_${runId}.csv`, download),
        );
        res.end(Buffer.from(mpesaCsv, "utf-8"));
        break;
      case "cash-payment":
        const cashPdfBuffer = await generateCashPaymentSheet(payrollData);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Cash_Sheet_${runId}.pdf`, download),
        );
        res.send(cashPdfBuffer);
        break;
      case "payroll-summary":
        const summaryExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Payroll Summary",
          companyDetails,
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Payroll_Summary_${runId}.xlsx`, download),
        );
        res.send(summaryExcelBuffer);
        break;
      case "allowance-report":
        const allowanceExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Allowance Report",
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Allowance_Report_${runId}.xlsx`, download),
        );
        res.send(allowanceExcelBuffer);
        break;
      case "deduction-report":
        const deductionExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Deduction Report",
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          getDisposition(`Deduction_Report_${runId}.xlsx`, download),
        );
        res.send(deductionExcelBuffer);
        break;
      default:
        return res.status(404).json({ error: "Report type not found." });
    }
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount);
  return isNaN(num) ? "0.00" : num.toFixed(2);
};

// Function to generate KRA SEC_B1 PAYE file (CSV)
const generateKraSecB1 = (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  // Define the fields for the CSV file. This acts as the header.
  const kraRecords = data.map((record) => {
    // Parse allowances and deductions
    const allowances =
      typeof record.allowances_details === "string"
        ? JSON.parse(record.allowances_details || "[]")
        : record.allowances_details || [];

    const deductions =
      typeof record.deductions_details === "string"
        ? JSON.parse(record.deductions_details || "[]")
        : record.deductions_details || [];

    // Helper function to get allowance by code
    const getAllowanceByCode = (code) => {
      return allowances.find((a) => a.code === code);
    };

    // Helper function to get deduction by code
    const getDeductionByCode = (code) => {
      return deductions.find((d) => d.code === code);
    };

    // Get specific allowances by code
    const housingAllowance = getAllowanceByCode("HOUSING");
    const carAllowance = getAllowanceByCode("CAR");
    const mealsAllowance = getAllowanceByCode("MEAL");

    // Calculate cash allowances (all cash allowances)
    const cashAllowances = allowances
      .filter((a) => a.type === "CASH" || a.is_cash === true)
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    // Calculate non-cash benefits excluding the ones we handle separately
    const otherNonCashBenefits = allowances
      .filter(
        (a) =>
          (a.type?.startsWith("NON_CASH") || a.is_cash === false) &&
          !["HOUSING", "CAR", "MEAL"].includes(a.code),
      )
      .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

    // Get specific deductions
    const mortgageDeduction = getDeductionByCode("MORTGAGE");
    const pensionDeduction = getDeductionByCode("PENSION");
    const prmfDeduction = getDeductionByCode("PRMF"); // Post Retirement Medical Fund
    const insuranceDeduction = deductions.find(
      (d) => d.code === "INS" || d.name?.toLowerCase().includes("insurance"),
    );

    // Calculate total non-cash benefits (excluding housing which goes in separate field)
    const totalNonCashBenefits =
      (carAllowance?.value || 0) +
      (mealsAllowance?.value || 0) +
      otherNonCashBenefits;

    // Determine housing benefit status
    const housingBenefitStatus =
      housingAllowance?.value > 0
        ? "Employer's owned House"
        : "Benefit not given";

    // Determine resident and disability status
    const residentStatus =
      record.employee?.citizenship?.toLowerCase() !== "kenyan"
        ? "Non-Resident"
        : "Resident";

    const employeeDisabilityStatus = record.employee?.has_disability
      ? "Yes"
      : "No";

    return [
      record.employee.krapin || "",
      `${record.employee.first_name || ""} ${
        record.employee.middle_name || ""
      } ${record.employee.last_name || ""}`.trim(),
      residentStatus || "Resident",
      record.employee.employee_type || "Primary Employee",
      employeeDisabilityStatus,
      "", // remember to fill this field with exemption certificate number if any
      formatCurrency(record.basic_salary || 0),
      formatCurrency(carAllowance?.value || 0),
      formatCurrency(mealsAllowance?.value || 0),
      formatCurrency(otherNonCashBenefits),
      housingBenefitStatus,
      formatCurrency(housingAllowance?.value || 0),
      formatCurrency(cashAllowances),
      "", // Blank
      formatCurrency(record.shif_deduction || 0),
      formatCurrency(record.nssf_deduction || 0),
      formatCurrency(pensionDeduction?.value || 0), // Other pension deductions (PENSION only)
      formatCurrency(prmfDeduction?.value || 0), // Post Retirement Medical Fund
      formatCurrency(mortgageDeduction?.value || 0), // Mortgage interest
      formatCurrency(record.housing_levy_deduction || 0),
      "", // Blank
      2400.0,
      record.insurance_relief || 0.0, // insurance relief not in payroll details
      "",
      formatCurrency(record.paye_tax),
    ];
  });
  return new Promise((resolve, reject) => {
    stringify(kraRecords, { header: false }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

// Function to generate NSSF Return file (Excel)
const generateNssfReturn = async (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("NSSF Return");

  const headers = [
    "Surname",
    "First Name",
    "Other names",
    "Gender",
    "Date of birth",
    "Date of Employement",
    "Marital Status",
    "ID number",
    "KRA pin",
    "NSSF Number",
    "Cell Phone",
    "Email",
    "Gross Salary",
    "Employee Tier 1",
    "Employer Tier 1",
    "Total Tier 1",
    "Employee Tier 2",
    "Employer Tier 2",
    "Total Tier 2",
  ];
  worksheet.addRow(headers);

  data.forEach((record) => {
    // Calculate totals
    const totalTier1 = parseFloat(record.nssf_tier1_deduction) * 2; // Employee + Employer
    const totalTier2 = parseFloat(record.nssf_tier2_deduction) * 2; // Employee + Employer
    worksheet.addRow([
      record.employee.last_name,
      record.employee.first_name,
      record.employee.middle_name || "",
      record.employee.gender,
      record.employee.date_of_birth,
      record.employee.hire_date,
      record.employee.marital_status || "",
      record.employee.id_number,
      record.employee.krapin,
      record.employee.nssf_number,
      record.employee.phone,
      record.employee.email,
      parseFloat(record.gross_pay),
      parseFloat(record.nssf_tier1_deduction),
      parseFloat(record.nssf_tier1_deduction),
      totalTier1,
      parseFloat(record.nssf_tier2_deduction),
      parseFloat(record.nssf_tier2_deduction),
      totalTier2,
    ]);
  });

  // Add a summary row at the bottom
  const totals = data.reduce(
    (acc, record) => {
      acc.grossPay += parseFloat(record.gross_pay) || 0;
      acc.tier1Employee += parseFloat(record.nssf_tier1_deduction) || 0;
      acc.tier2Employee += parseFloat(record.nssf_tier2_deduction) || 0;
      return acc;
    },
    { grossPay: 0, tier1Employee: 0, tier2Employee: 0 },
  );

  // Add empty row before summary
  worksheet.addRow([]);

  // Add summary row
  worksheet.addRow([
    "TOTALS",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totals.grossPay.toFixed(2),
    totals.tier1Employee.toFixed(2),
    totals.tier1Employee.toFixed(2), // Employer matches employee
    (totals.tier1Employee * 2).toFixed(2),
    totals.tier2Employee.toFixed(2),
    totals.tier2Employee.toFixed(2), // Employer matches employee
    (totals.tier2Employee * 2).toFixed(2),
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

const generateShifReturn = async (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("SHIF Return");
  const headers = [
    "Payroll number",
    "First Name",
    "Last Name",
    "ID number",
    "KRA pin",
    "SHIF number",
    "Contribution Amount",
    "Phone Number",
  ];
  worksheet.addRow(headers);
  data.forEach((record) => {
    worksheet.addRow([
      record.payroll_run.payroll_number,
      record.employee.first_name,
      record.employee.last_name,
      record.employee.id_number,
      record.employee.krapin,
      record.employee.shif_number,
      parseFloat(record.shif_deduction),
      record.employee.phone, // Assuming phone number is from employee record
    ]);
  });
  return await workbook.xlsx.writeBuffer();
};

const generateHousingLevyReturn = (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const records = data.map((record) => [
    record.employee.id_number || "",
    `${record.employee.first_name || ""} ${record.employee.middle_name || ""} ${
      record.employee.last_name || ""
    }`.trim(),
    record.employee.krapin || "",
    formatCurrency(record.housing_levy_deduction || 0),
  ]);
  return new Promise((resolve, reject) => {
    stringify(records, { header: false }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateHelbReport = async (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("HELB Report");
  const headers = ["ID number", "Full Name", "Staff Number", "Amount Deducted"];
  worksheet.addRow(headers);
  data.forEach((record) => {
    if (parseFloat(record.helb_deduction) > 0) {
      worksheet.addRow([
        record.employee.id_number,
        `${record.employee.first_name} ${record.employee.middle_name || ""} ${
          record.employee.last_name
        }`.trim(),
        record.employee.employee_number,
        parseFloat(record.helb_deduction),
      ]);
    }
  });
  return await workbook.xlsx.writeBuffer();
};

const generateBankPaymentFile = (data, companyDetails) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  // Use company's bank account for debit account
  const debitAccount = companyDetails?.account_number || "";

  const records = data
    .filter((r) => r.payment_method?.toLowerCase() === "bank")
    .map((record) => [
      "", // Additional info 1 (leave blank)
      `${record.employee.first_name || ""} ${record.employee.middle_name || ""} ${
        record.employee.last_name || ""
      }`.trim(), // Beneficiary Name
      "", // Beneficiary Address (leave blank)
      "", // BIC/SWIFT Code (leave blank)
      record.branch_name || "", // Branch
      record.bank_name || "", // Beneficiary Bank Name
      "031", // DTB Branch Code (using branch_code from payroll_details)
      record.account_number || "", // Beneficiary Account
      formatCurrency(record.net_pay), // Payable Amount
      "RTGS", // Payment Method (default to RTGS for bank payments)
      `Payroll Ref ${record.payroll_run?.payroll_number || ""}`, // Additional info 2 (reference)
      "KES", // Payable Currency (always KES for Kenya)
      debitAccount, // Debit Account No from company
      "", // Payment Instructions 1 (leave blank)
      "", // Mobile service provider Code (leave blank for bank)
      "", // Bene Mobile Number (leave blank for bank)
      "", // Execution date
      "", // Supporting Document Name (leave blank)
      record.employee?.email || "", // Email
      "BEN", // Charge Bourned By (BEN = Beneficiary, OUR = Ourselves, SHA = Shared)
      "SALA", // Remittance Purpose code (SALA = Salary Payment)
      `Salary payment for ${record.employee?.first_name || ""} ${record.employee?.last_name || ""}`, // Remittance Purpose details
    ]);
  const columns = [
    "Additional info 1",
    "Beneficiary Name",
    "Beneficiary Address",
    "BIC/SWIFT Code",
    "Branch",
    "Beneficiary Bank Name",
    "DTB Branch Code",
    "Beneficiary Account",
    "Payable Amount",
    "Payment Method",
    "Additional info 2",
    "Payable Currency",
    "Debit Account No",
    "Payment Instructions 1",
    "Mobile service provider Code",
    "Bene Mobile Number",
    "Execution Date",
    "Supporting Document Name",
    "Email",
    "Charge Bourned By",
    "Remittance Purpose code",
    "Remittance Purpose details",
  ];
  return new Promise((resolve, reject) => {
    stringify(records, { header: true, columns: columns }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateMpesaPaymentFile = (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const records = data
    .filter((r) => r.payment_method?.toLowerCase() === "m-pesa")
    .map((record) => [
      `${record.employee.first_name} ${record.employee.middle_name || ""} ${
        record.employee.last_name
      }`.trim(),
      record.mobile_phone,
      formatCurrency(record.net_pay),
      `Payroll Ref ${record.payroll_run.payroll_number}`,
    ]);
  const columns = ["fullname", "mpesa phone number", "amount", "reference"];
  return new Promise((resolve, reject) => {
    stringify(records, { header: true, columns: columns }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateCashPaymentSheet = async (data) => {
  // Sort the data array by employee number
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(12).text("Cash Payment Sheet", { align: "center" });
    doc.moveDown();

    const tableTop = doc.y;
    const table = {
      headers: ["No.", "Full Name", "ID Number", "Net Pay (KSh)", "Signature"],
      rows: data
        .filter((r) => r.payment_method?.toLowerCase() === "cash")
        .map((record, index) => [
          (index + 1).toString(),
          `${record.employee.first_name} ${record.employee.middle_name || ""} ${
            record.employee.last_name
          }`.trim(),
          record.employee.id_number,
          formatCurrency(record.net_pay),
          "", // Blank for signature
        ]),
    };

    const tableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = tableWidth / table.headers.length;

    // Draw headers
    doc.font("Helvetica-Bold").fontSize(10);
    let currentX = doc.page.margins.left;
    table.headers.forEach((header) => {
      doc.text(header, currentX, tableTop, {
        width: colWidth,
        align: "center",
      });
      currentX += colWidth;
    });

    // Draw rows
    doc.font("Helvetica").fontSize(9);
    let currentY = tableTop + 20;
    table.rows.forEach((row) => {
      currentX = doc.page.margins.left;
      row.forEach((cell) => {
        doc.text(cell, currentX, currentY, {
          width: colWidth,
          align: "center",
        });
        currentX += colWidth;
      });
      currentY += 20;
    });

    doc.end();
  });
};

// Generic report generation (Payroll Summary, Allowance, Deduction)
const generateGenericExcelReport = async (data, reportType, companyDetails) => {
  // --- SORTING BLOCK ---
  // Sort the data array by employee number for all generic reports
  data.sort((a, b) => {
    const codeA = a.employee?.employee_number || "";
    const codeB = b.employee?.employee_number || "";
    return codeA.localeCompare(codeB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  // ------------------------------

  const workbook = new ExcelJS.Workbook();
  //const worksheet = workbook.addWorksheet(reportType);
  let headers;

  if (reportType === "Payroll Summary") {
    // We add the single sheet here instead of globally
    const worksheet = workbook.addWorksheet(reportType);

    // Check if data is available to prevent errors on empty reports
    if (!data || data.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }
    //  Get payroll details for the title
    const firstRecord = data[0];
    const payrollNumber = firstRecord.payroll_run?.payroll_number || "N/A";
    const payrollMonth = new Date(
      `${payrollNumber.split("-")[1].substring(4, 6)}/01/${payrollNumber
        .split("-")[1]
        .substring(0, 4)}`,
    ).toLocaleString("default", { month: "long" });
    const payrollYear = payrollNumber.split("-")[1].substring(0, 4);

    //  --------- Header Section (Row 1-5) ------------

    // 1. Merge cells for the header section
    worksheet.mergeCells("A1:K5");

    // 2. Combine all header text into a single value for the merged cell A1
    const mainTitle = `MONTHLY PAYROLL SUMMARY: ${payrollMonth.toUpperCase()} ${payrollYear}`;
    const departmentInfo = "DEPARTMENT: ALL";

    // Set the value of the merged cell. Use newlines for formatting.
    const mergedCell = worksheet.getCell("A1");
    mergedCell.value = `${
      companyDetails?.business_name?.toUpperCase() || "YOUR COMPANY"
    }\n${mainTitle}\n${departmentInfo}`;

    // Apply styles to the merged cell
    mergedCell.font = {
      bold: true,
      size: 14,
    };
    mergedCell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    mergedCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFFFF" }, // White background
    };
    mergedCell.border = {
      top: { style: "none" },
      left: { style: "none" },
      bottom: { style: "none" },
      right: { style: "none" },
    };
    // 1. Company Logo
    const logoUrl = companyDetails?.logo_url;
    if (logoUrl) {
      try {
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.buffer();
        const logoImage = workbook.addImage({
          buffer: logoBuffer,
          extension: "jpeg",
        });
        worksheet.addImage(logoImage, {
          tl: { col: 1, row: 1 },
          ext: { width: 60, height: 60 },
        });
      } catch (e) {
        console.error("Failed to add logo:", e);
      }
    }

    // Space after header
    const dataStartRow = 6;

    //detemine unique allowance and deduction types
    // Determine unique allowance and deduction types
    const uniqueAllowances = new Set();
    const uniqueDeductions = new Set();

    data.forEach((record) => {
      const allowances = record.allowances_details || [];
      const deductions = record.deductions_details || [];
      if (Array.isArray(allowances)) {
        allowances.forEach((a) => uniqueAllowances.add(a.name));
      }
      if (Array.isArray(deductions)) {
        deductions.forEach((d) => uniqueDeductions.add(d.name));
      }
    });

    const allowanceNames = Array.from(uniqueAllowances).sort();
    const deductionNames = Array.from(uniqueDeductions).sort();

    // 4. Define headers
    const fixedHeadersBeforeAllowances = ["EMP. No.", "NAME", "BASIC PAY"];
    const fixedHeadersAfterAllowances = [
      "GROSS PAY",
      "PAYE",
      "NSSF",
      "SHIF",
      "HOUSING LEVY",
    ];
    const fixedHeadersAfterDeductions = ["TOTAL DED.", "NET PAY (KSH.)"];

    headers = [
      ...fixedHeadersBeforeAllowances,
      ...allowanceNames.map((name) => name.toUpperCase()),
      ...fixedHeadersAfterAllowances,
      ...deductionNames.map((name) => name.toUpperCase()),
      ...fixedHeadersAfterDeductions,
    ];

    worksheet.addRow(headers).eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF0F0F0" }, // Light gray background
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // 5. Populate data rows and calculate totals
    const totals = new Array(headers.length).fill(0);
    const totalsMapping = {
      "EMP. No.": "ignore",
      NAME: "ignore",
      "BASIC PAY": "basic_salary",
      "GROSS PAY": "gross_pay",
      PAYE: "paye_tax",
      NSSF: "nssf_deduction",
      SHIF: "shif_deduction",
      "HOUSING LEVY": "housing_levy_deduction",
      "TOTAL DED.": "total_deductions",
      "NET PAY (KSH.)": "net_pay",
    };

    data.forEach((record) => {
      const rowData = {};
      const allowances = Array.isArray(record.allowances_details)
        ? record.allowances_details
        : JSON.parse(record.allowances_details || "[]");
      const deductions = Array.isArray(record.deductions_details)
        ? record.deductions_details
        : JSON.parse(record.deductions_details || "[]");

      // Map dynamic allowances to rowData
      allowanceNames.forEach((name) => {
        const allowance = allowances.find((a) => a.name === name);
        rowData[name.toUpperCase()] = parseFloat(allowance?.value || 0);
      });

      // Map dynamic deductions to rowData
      deductionNames.forEach((name) => {
        const deduction = deductions.find((d) => d.name === name);
        rowData[name.toUpperCase()] = parseFloat(deduction?.value || 0);
      });

      // Construct the row array in the correct order
      const row = [];
      headers.forEach((header) => {
        if (header === "EMP. No.") {
          row.push(record.employee?.employee_number || "");
        } else if (header === "NAME") {
          row.push(
            `${record.employee?.first_name || ""} ${
              record.employee?.last_name || ""
            } ${record.employee?.middle_name || ""}`,
          );
        } else if (totalsMapping[header]) {
          row.push(parseFloat(record[totalsMapping[header]] || 0));
        } else {
          row.push(rowData[header] || 0);
        }
      });
      worksheet.addRow(row);

      // Calculate totals
      row.forEach((value, index) => {
        if (index > 1 && !isNaN(parseFloat(value))) {
          totals[index] += parseFloat(value);
        }
      });
    });

    // 6. Add the totals row
    const totalsRow = ["", "TOTALS", ...totals.slice(2)];
    worksheet.addRow(totalsRow).eachCell((cell) => {
      cell.font = { bold: true };
    });

    // 7. Apply number formatting
    worksheet.columns.forEach((column, index) => {
      if (index > 1) {
        // Apply to all columns except EMP. No. and NAME
        column.numFmt = "#,##0.00";
      }
    });

    // 8. Adjust column widths
    worksheet.columns.forEach((column) => {
      const header = column.header;
      let maxLength = 0;
      if (header) {
        maxLength = header.toString().length;
      }
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? cell.value.toString().length : 0;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.max(10, Math.min(15, maxLength + 2));
    });

    // ---------- Footer Section ----------

    const lastRow = worksheet.lastRow.number + 3;
    const preparedByCell = worksheet.getCell(`B${lastRow}`);
    preparedByCell.value =
      "PREPARED BY: .......................................";
    const checkedByCell = worksheet.getCell(`E${lastRow}`);
    checkedByCell.value =
      "CHECKED BY: ........................................";
    const preparedDateCell = worksheet.getCell(`B${lastRow + 1}`);
    preparedDateCell.value =
      "DATE: ...............................................";
    const checkedDateCell = worksheet.getCell(`E${lastRow + 1}`);
    checkedDateCell.value =
      "DATE: .................................................";
    worksheet.mergeCells(`B${lastRow}:D${lastRow}`);
    worksheet.mergeCells(
      `E${lastRow}:${String.fromCharCode(
        70 + headers.length - 1 - 4,
      )}${lastRow}`,
    );
    worksheet.mergeCells(`B${lastRow + 1}:D${lastRow + 1}`);
    worksheet.mergeCells(
      `E${lastRow + 1}:${String.fromCharCode(70 + headers.length - 1 - 4)}${
        lastRow + 1
      }`,
    );
  } else if (reportType === "Allowance Report") {
    const worksheet = workbook.addWorksheet(reportType);
    headers = ["Employee No", "Full Name", "Allowance Name", "Amount"];
    worksheet.addRow(headers);
    data.forEach((record) => {
      const allowances = record.allowances_details || [];
      if (Array.isArray(allowances)) {
        allowances.forEach((allowance) => {
          worksheet.addRow([
            record.employee.employee_number,
            `${record.employee.first_name} ${record.employee.last_name}`,
            allowance.name,
            parseFloat(allowance.value),
          ]);
        });
      }
    });
  } else if (reportType === "Deduction Report") {
    const worksheet = workbook.addWorksheet(reportType);
    headers = ["Employee No", "Full Name", "Deduction Name", "Amount"];
    worksheet.addRow(headers);
    data.forEach((record) => {
      const deductions = record.deductions_details || [];
      if (Array.isArray(deductions)) {
        deductions.forEach((deduction) => {
          worksheet.addRow([
            record.employee.employee_number,
            `${record.employee.first_name} ${record.employee.last_name}`,
            deduction.name,
            parseFloat(deduction.value),
          ]);
        });
      }
    });
  }

  return await workbook.xlsx.writeBuffer();
};
