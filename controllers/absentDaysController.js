import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
import { authorize } from "../utils/authorize.js";
const { utils, read } = pkg;

// Helper function to check company access
export const checkCompanyAccess = async (companyId, userId, module, rule) => {
  // 1️ Get workspace_id of the company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("workspace_id")
    .eq("id", companyId)
    .single();

  if (companyError || !company) return false;

  // 2️ Check if user belongs to that workspace
  const { data: workspaceUser, error: workspaceError } = await supabase
    .from("workspace_users")
    .select("id")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", userId)
    .single();

  if (workspaceError || !workspaceUser) return false;

  // 3️ Check user belongs to this company
  const { data: companyUser } = await supabase
    .from("company_users")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!companyUser) return false;

  const auth = await authorize(userId, company.workspace_id, module, rule);

  if (!auth.allowed) return false;

  return true;
};

// Helper function to parse Excel dates
function parseExcelDate(dateValue) {
  if (!dateValue && dateValue !== 0) return null;
  
  if (typeof dateValue === 'number') {
    try {
      const excelEpoch = new Date(1900, 0, 1);
      const days = dateValue - 1;
      const adjustedDays = days > 59 ? days - 1 : days;
      const result = new Date(excelEpoch.getTime() + adjustedDays * 24 * 60 * 60 * 1000);
      
      if (isNaN(result.getTime())) {
        return null;
      }
      return result.toISOString().split('T')[0];
    } catch (e) {
      console.error("Error parsing Excel date:", e);
      return null;
    }
  }
  
  if (typeof dateValue === 'string') {
    const str = dateValue.trim();
    const yyyyMmDdRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (yyyyMmDdRegex.test(str)) {
      return str;
    }
    
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return null;
}

// ASSIGN ABSENT DAYS
export const assignAbsentDays = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    employee_id,
    month,
    year,
    absent_days,
    total_deduction_amount,
    notes,
  } = req.body;

  // Validate month and year
  if (month < 1 || month > 12) {
    return res.status(400).json({ error: "Month must be between 1 and 12" });
  }

  if (year < 2000 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const payload = {
    company_id: companyId,
    employee_id,
    month,
    year,
    absent_days,
    total_deduction_amount,
    notes,
    updated_at: new Date().toISOString(),
  };

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to assign absent days.",
      });
    }

    // Check if record already exists for this employee/month/year
    const { data: existing } = await supabase
      .from("employee_absent_days")
      .select("id")
      .eq("employee_id", employee_id)
      .eq("month", month)
      .eq("year", year)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ 
        error: "Absent days record already exists for this employee for the specified month/year. Use update instead." 
      });
    }

    const { data, error } = await supabase
      .from("employee_absent_days")
      .insert([payload])
      .select(`
        *,
        employees:employee_id(first_name, last_name, employee_number)
      `);

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (err) {
    console.error("Error assigning absent days:", err);
    res.status(500).json({ error: "Failed to assign absent days" });
  }
};

// GET ALL ABSENT DAYS
export const getAbsentDays = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { month, year, employee_id } = req.query;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view absent days.",
      });
    }

    let query = supabase
      .from("employee_absent_days")
      .select(`
        *,
        employees:employee_id(first_name, last_name, employee_number)
      `)
      .eq("company_id", companyId);

    // Apply filters if provided
    if (month) query = query.eq("month", month);
    if (year) query = query.eq("year", year);
    if (employee_id) query = query.eq("employee_id", employee_id);

    const { data, error } = await query.order("year", { ascending: false }).order("month", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Error fetching absent days:", err);
    res.status(500).json({ error: "Failed to fetch absent days" });
  }
};

// GET ONE ABSENT DAYS RECORD
export const getAbsentDaysById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view absent days.",
      });
    }

    const { data, error } = await supabase
      .from("employee_absent_days")
      .select(`
        *,
        employees:employee_id(first_name, last_name, employee_number)
      `)
      .eq("id", id)
      .eq("company_id", companyId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Error fetching absent days:", err);
    res.status(404).json({ error: "Absent days record not found" });
  }
};

// UPDATE ABSENT DAYS
export const updateAbsentDays = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;
  const {
    absent_days,
    total_deduction_amount,
    notes,
    month,
    year
  } = req.body;

  // Validate month and year if provided
  if (month && (month < 1 || month > 12)) {
    return res.status(400).json({ error: "Month must be between 1 and 12" });
  }

  if (year && (year < 2000 || year > 2100)) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const payload = {
    absent_days,
    total_deduction_amount,
    notes,
    month,
    year,
    updated_at: new Date().toISOString(),
  };

  // Remove undefined fields
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update absent days.",
      });
    }

    const { data, error } = await supabase
      .from("employee_absent_days")
      .update(payload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select(`
        *,
        employees:employee_id(first_name, last_name, employee_number)
      `)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Error updating absent days:", err);
    res.status(500).json({ error: "Failed to update absent days" });
  }
};

// DELETE ABSENT DAYS
export const deleteAbsentDays = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_delete",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete absent days.",
      });
    }

    const { error } = await supabase
      .from("employee_absent_days")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) throw error;
    res.json({ message: "Absent days record deleted successfully" });
  } catch (err) {
    console.error("Error deleting absent days:", err);
    res.status(500).json({ error: "Failed to delete absent days" });
  }
};

// BULK DELETE ABSENT DAYS
export const bulkDeleteAbsentDays = async (req, res) => {
  const { companyId } = req.params;
  const { ids } = req.body;
  const userId = req.userId;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No IDs provided for deletion." });
  }

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_delete",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete absent days.",
      });
    }

    const { error } = await supabase
      .from("employee_absent_days")
      .delete()
      .in("id", ids)
      .eq("company_id", companyId);

    if (error) {
      console.error("Bulk delete absent days error:", error);
      return res.status(500).json({ error: "Failed to delete absent days records" });
    }

    res.status(200).json({
      message: `${ids.length} absent days record(s) deleted successfully.`,
    });
  } catch (err) {
    console.error("Bulk delete absent days controller error:", err);
    res.status(500).json({ error: "An unexpected error occurred during bulk deletion." });
  }
};

// GENERATE TEMPLATE FOR BULK IMPORT
export const generateAbsentDaysTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to generate template.",
      });
    }

    // Fetch employees for reference
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("employee_number, first_name, last_name")
      .eq("company_id", companyId)
      .eq("employee_status", "ACTIVE");

    if (employeesError) throw employeesError;

    // Sort employees
    employees.sort((a, b) => {
      const numA = a.employee_number || "";
      const numB = b.employee_number || "";
      return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: "base" });
    });

    const workbook = new ExcelJS.Workbook();

    // --- MAIN SHEET ---
    const mainSheet = workbook.addWorksheet("Absent Days");

    const headers = [
      { header: "Employee Number", key: "employee_number", width: 20 },
      { header: "Month (1-12)", key: "month", width: 15 },
      { header: "Year (e.g., 2025)", key: "year", width: 15 },
      { header: "Absent Days", key: "absent_days", width: 15 },
      { header: "Total Deduction Amount", key: "amount", width: 25 },
      { header: "Notes", key: "notes", width: 40 },
    ];

    mainSheet.columns = headers;
    
    // Style header row
    const headerRow = mainSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add sample row with instructions
    mainSheet.addRow([
      "EMP001", 
      "3", 
      "2025", 
      "5", 
      "2500.00", 
      "Sick leave"
    ]);

    // Add empty rows for data entry
    for (let i = 3; i <= 1000; i++) {
      mainSheet.addRow([]);
    }

    // --- REFERENCE SHEET ---
    const refSheet = workbook.addWorksheet("Reference (Read Only)");

    // Style reference sheet header
    const refHeaderRow = refSheet.getRow(1);
    refHeaderRow.font = { bold: true };
    refHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' }
    };

    // Add Employees section
    refSheet.getCell('A1').value = 'ACTIVE EMPLOYEES';
    refSheet.getCell('A2').value = 'Employee Number';
    refSheet.getCell('B2').value = 'Full Name';
    
    employees.forEach((emp, index) => {
      const rowNum = index + 3;
      refSheet.getCell(`A${rowNum}`).value = emp.employee_number;
      refSheet.getCell(`B${rowNum}`).value = `${emp.first_name} ${emp.last_name}`.trim();
    });

    // Style reference sheet columns
    refSheet.columns = [
      { width: 20 }, // A: Employee Number
      { width: 30 }, // B: Full Name
    ];

    // Protect reference sheet
    refSheet.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false
    });

    // --- DROPDOWNS ON MAIN SHEET ---
    
    // Employee Number dropdown
    const employeeList = employees.map(e => e.employee_number);

    for (let i = 2; i <= 1000; i++) {
      // Employee Number dropdown
      if (employeeList.length > 0) {
        mainSheet.getCell(`A${i}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`"${employeeList.join(',')}"`],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: 'Invalid Employee Number',
          error: 'Please select a valid employee number from the list'
        };
      }

      // Month dropdown
      mainSheet.getCell(`B${i}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"1,2,3,4,5,6,7,8,9,10,11,12"'],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Invalid Month',
        error: 'Month must be between 1 and 12'
      };
    }

    // Add notes sheet
    const notesSheet = workbook.addWorksheet("Instructions");
    notesSheet.getCell('A1').value = 'INSTRUCTIONS FOR BULK ABSENT DAYS IMPORT';
    notesSheet.getCell('A1').font = { bold: true, size: 14 };
    
    notesSheet.getCell('A3').value = '1. Use the "Absent Days" sheet to enter your data';
    notesSheet.getCell('A4').value = '2. Use the "Reference (Read Only)" sheet to see available active employees';
    notesSheet.getCell('A5').value = '3. Column explanations:';
    notesSheet.getCell('A6').value = '   - Employee Number: Select from dropdown (based on active employees)';
    notesSheet.getCell('A7').value = '   - Month: Enter month number (1-12)';
    notesSheet.getCell('A8').value = '   - Year: Enter year (e.g., 2025)';
    notesSheet.getCell('A9').value = '   - Absent Days: Number of days absent';
    notesSheet.getCell('A10').value = '   - Total Deduction Amount: The amount to deduct (user enters this)';
    notesSheet.getCell('A11').value = '   - Notes: Optional notes about the absence';
    
    notesSheet.getCell('A13').value = '4. All fields except Notes are required';
    notesSheet.getCell('A14').value = '5. Each employee can only have ONE record per month/year combination';
    notesSheet.getCell('A15').value = '6. If you try to import duplicate records, the import will fail for those rows';
    
    // Style notes sheet
    notesSheet.columns = [{ width: 80 }];
    for (let i = 3; i <= 15; i++) {
      notesSheet.getCell(`A${i}`).font = { size: 11 };
    }

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Absent_Days_Import_Template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating absent days template:", error);
    res.status(500).json({ error: "Failed to generate absent days template." });
  }
};

// BULK IMPORT ABSENT DAYS
export const importAbsentDays = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to import absent days.",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const workbook = read(file.buffer, { type: "buffer" });
    
    // Get the main sheet
    const mainSheetName = workbook.SheetNames.find(name => 
      name === "Absent Days" || name.includes("Absent")
    );
    
    if (!mainSheetName) {
      return res.status(400).json({ 
        error: "Invalid template format. Please use the downloaded template." 
      });
    }

    const worksheet = workbook.Sheets[mainSheetName];
    
    // Parse sheet to JSON
    const jsonData = utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false
    });

    // Filter out empty rows and header row
    const dataRows = jsonData.slice(1).filter(row => 
      row && row.some(cell => cell !== null && cell !== undefined && cell !== '')
    );

    if (dataRows.length === 0) {
      return res.status(400).json({ error: "No data found in the uploaded file." });
    }

    // Fetch employee map
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, employee_number")
      .eq("company_id", companyId);

    if (employeesError) throw employeesError;

    const empMap = new Map(employees.map(e => [e.employee_number, e.id]));

    const toInsert = [];
    const errors = [];

    for (const [index, row] of dataRows.entries()) {
      const rowNumber = index + 2; // Account for header row
      
      const employeeNumber = row[0]?.toString().trim();
      const month = row[1] ? parseInt(row[1].toString().trim()) : null;
      const year = row[2] ? parseInt(row[2].toString().trim()) : null;
      const absentDays = row[3] ? parseInt(row[3].toString().trim()) : null;
      const amount = row[4] ? parseFloat(row[4].toString().trim()) : null;
      const notes = row[5]?.toString().trim() || null;

      // Skip empty rows
      if (!employeeNumber && !month && !year && !absentDays && !amount) {
        continue;
      }

      // Validate required fields
      const missingFields = [];
      if (!employeeNumber) missingFields.push("Employee Number");
      if (!month) missingFields.push("Month");
      if (!year) missingFields.push("Year");
      if (!absentDays && absentDays !== 0) missingFields.push("Absent Days");
      if (!amount && amount !== 0) missingFields.push("Total Deduction Amount");

      if (missingFields.length > 0) {
        errors.push(`Row ${rowNumber}: Missing required fields: ${missingFields.join(', ')}`);
        continue;
      }

      // Validate employee exists
      const employeeId = empMap.get(employeeNumber);
      if (!employeeId) {
        errors.push(`Row ${rowNumber}: Employee "${employeeNumber}" not found.`);
        continue;
      }

      // Validate month
      if (month < 1 || month > 12) {
        errors.push(`Row ${rowNumber}: Month must be between 1 and 12, got "${month}"`);
        continue;
      }

      // Validate year
      if (year < 2000 || year > 2100) {
        errors.push(`Row ${rowNumber}: Year must be between 2000 and 2100, got "${year}"`);
        continue;
      }

      // Validate absent days
      if (isNaN(absentDays) || absentDays < 0) {
        errors.push(`Row ${rowNumber}: Absent days must be a positive number, got "${row[3]}"`);
        continue;
      }

      // Validate amount
      if (isNaN(amount) || amount < 0) {
        errors.push(`Row ${rowNumber}: Total deduction amount must be a positive number, got "${row[4]}"`);
        continue;
      }

      // Check for duplicate within the import batch
      const duplicateInBatch = toInsert.some(item => 
        item.employee_id === employeeId && 
        item.month === month && 
        item.year === year
      );

      if (duplicateInBatch) {
        errors.push(`Row ${rowNumber}: Duplicate record for employee ${employeeNumber} for month ${month}/${year} in the same import file.`);
        continue;
      }

      toInsert.push({
        company_id: companyId,
        employee_id: employeeId,
        month,
        year,
        absent_days: absentDays,
        total_deduction_amount: amount,
        notes,
        updated_at: new Date().toISOString()
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Import failed due to validation errors.",
        details: errors
      });
    }

    if (toInsert.length === 0) {
      return res.status(400).json({ error: "No valid data to import." });
    }

    // Insert the absent days records
    const { data, error } = await supabase
      .from("employee_absent_days")
      .insert(toInsert)
      .select();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') { // PostgreSQL unique violation code
        return res.status(400).json({ 
          error: "Duplicate records found. Some employees already have absent days records for the specified month/year.",
          details: error.details
        });
      }
      console.error("Insert error:", error);
      throw error;
    }

    res.status(200).json({
      message: `Successfully imported ${data.length} absent days record(s).`,
      count: data.length,
    });

  } catch (error) {
    console.error("Import absent days controller error:", error);
    res.status(500).json({ error: error.message || "Failed to import absent days" });
  }
};