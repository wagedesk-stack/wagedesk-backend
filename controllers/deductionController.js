import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
import { authorize } from "../utils/authorize.js";
const { utils, read } = pkg;

// Month name constants for validation
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

const monthNames = [
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
// -------------------- Helper Functions -------------------- //
// Helper function to check for company ownershi
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

// Helper to validate month name
const isValidMonth = (month) => {
  return MONTHS.includes(month);
};

// Helper to calculate end month/year from start and duration
const calculateEndPeriod = (startMonth, startYear, numberOfMonths) => {
  const startMonthIndex = MONTHS.indexOf(startMonth);
  // For 1 month, end should be same as start
  // For 2+ months, calculate properly
  const totalMonths = startMonthIndex + (numberOfMonths - 1);

  const endYear = startYear + Math.floor(totalMonths / 12);
  const endMonthIndex = totalMonths % 12;
  const endMonth = MONTHS[endMonthIndex];

  return { endMonth, endYear };
};

// -------------------- Controller Functions -------------------- //
// ASSIGN
export const assignDeduction = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    deduction_type_id,
    applies_to,
    employee_id,
    department_id,
    sub_department_id,
    job_title_id,
    value,
    calculation_type,
    is_recurring = true,
    start_month,
    start_year,
    number_of_months,
    metadata = {},
  } = req.body;

  // Validate month
  if (!isValidMonth(start_month)) {
    return res.status(400).json({
      error: `Invalid start_month. Must be one of: ${MONTHS.join(", ")}`,
    });
  }

  // Calculate end month/year
  let end_month = null;
  let end_year = null;
  if (!is_recurring && number_of_months && start_month && start_year) {
    const { endMonth, endYear } = calculateEndPeriod(
      start_month,
      parseInt(start_year),
      parseInt(number_of_months),
    );
    end_month = endMonth;
    end_year = endYear;
  }

  const payload = {
    company_id: companyId,
    deduction_type_id,
    applies_to,
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    end_month,
    end_year,
    metadata,
    // Targeting Logic: Nullify irrelevant IDs based on applies_to
    employee_id: applies_to === "INDIVIDUAL" ? employee_id : null,
    department_id: applies_to === "DEPARTMENT" ? department_id : null,
    sub_department_id:
      applies_to === "SUB_DEPARTMENT" ? sub_department_id : null,
    job_title_id: applies_to === "JOB_TITLE" ? job_title_id : null,
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
        error: "Unauthorized to assign deduction.",
      });
    }

    const { data, error } = await supabase
      .from("deductions")
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to assign deduction" });
  }
};

// GET ALL
export const getDeductions = async (req, res) => {
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
        error: "Unauthorized to view deductions.",
      });
    }

    const { data, error } = await supabase
      .from("deductions")
      .select(
        `
        *, 
        deduction_types(name, code, is_pre_tax), 
        employees(first_name, middle_name, last_name, employee_number), 
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("company_id", companyId);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deductions" });
  }
};

// GET ONE
export const getDeductionById = async (req, res) => {
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
        error: "Unauthorized to view deductions.",
      });
    }

    const { data, error } = await supabase
      .from("deductions")
      .select(
        `
        *,
        deduction_types(name, code, is_pre_tax), 
        employees(first_name, last_name, employee_number), 
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: "Deduction not found" });
  }
};

// UPDATE
export const updateDeduction = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;
  const {
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    metadata,
  } = req.body;

  // Validate month if provided
  if (start_month && !isValidMonth(start_month)) {
    return res.status(400).json({
      error: `Invalid start_month. Must be one of: ${MONTHS.join(", ")}`,
    });
  }

  // Calculate end month/year if non-recurring with duration
  let end_month = null;
  let end_year = null;
  if (!is_recurring && number_of_months && start_month && start_year) {
    const { endMonth, endYear } = calculateEndPeriod(
      start_month,
      parseInt(start_year),
      parseInt(number_of_months),
    );
    end_month = endMonth;
    end_year = endYear;
  }

  const payload = {
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    end_month,
    end_year,
    metadata,
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
        error: "Unauthorized to update deduction.",
      });
    }

    const { data, error } = await supabase
      .from("deductions")
      .update(payload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select(
        `
        *,
        deduction_types(name, code, is_pre_tax), 
        employees(first_name, last_name, employee_number), 
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to update deduction" });
  }
};

// REMOVE
export const removeDeduction = async (req, res) => {
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
        error: "Unauthorized to delete deduction.",
      });
    }

    const { error } = await supabase
      .from("deductions")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw error;
    res.json({ message: "Deduction removed successfully" });
  } catch (err) {
    console.error("Remove deduction error:", err);
    res.status(500).json({ error: "Failed to remove deduction" });
  }
};

// bulk delete
export const bulkDeleteDeductions = async (req, res) => {
  const { companyId } = req.params;
  const { deductionIds } = req.body; // Expecting an array of IDs in the body
  const userId = req.user.id;

  if (
    !deductionIds ||
    !Array.isArray(deductionIds) ||
    deductionIds.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "No deduction IDs provided for deletion." });
  }

  // 1. Check company ownership - Assuming checkCompanyOwnership is available in this file
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "PAYROLL",
    "can_delete",
  );
  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to delete deduction.",
    });
  }

  try {
    // 2. Perform bulk delete
    const { error } = await supabase
      .from("deductions")
      .delete()
      .in("id", deductionIds) // Filter by the array of IDs
      .eq("company_id", companyId); // Ensure only deductions for the company are deleted

    if (error) {
      console.error("Bulk delete deductions error:", error);
      return res.status(500).json({ error: "Failed to delete deductions." });
    }

    res.status(200).json({
      message: `${deductionIds.length} deduction(s) deleted successfully.`,
    });
  } catch (error) {
    console.error("Bulk delete deductions controller error:", err);
    console.error("Bulk delete deductions general error:", error);
    res
      .status(500)
      .json({ error: "An unexpected error occurred during bulk deletion." });
  }
};

// GENERATE TEMPLATE FOR BULK DEDUCTION IMPORT
export const generateDeductionTemplate = async (req, res) => {
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
        error: "Unauthorized to view deduction template.",
      });
    }

    // Fetch all required data
    const [
      employeesResult,
      deductionTypesResult,
      departmentsResult,
      subDepartmentsResult,
      jobTitlesResult,
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("employee_number, first_name, last_name")
        .eq("company_id", companyId),
      supabase
        .from("deduction_types")
        .select("name, code, is_pre_tax")
        .eq("company_id", companyId),
      supabase.from("departments").select("name").eq("company_id", companyId),
      supabase
        .from("sub_departments")
        .select("name")
        .eq("company_id", companyId),
      supabase.from("job_titles").select("title").eq("company_id", companyId),
    ]);

    if (employeesResult.error) throw employeesResult.error;
    if (deductionTypesResult.error) throw deductionTypesResult.error;
    if (departmentsResult.error) throw departmentsResult.error;
    if (subDepartmentsResult.error) throw subDepartmentsResult.error;
    if (jobTitlesResult.error) throw jobTitlesResult.error;

    const employees = employeesResult.data || [];
    const deductionTypes = deductionTypesResult.data || [];
    const departments = departmentsResult.data || [];
    const subDepartments = subDepartmentsResult.data || [];
    const jobTitles = jobTitlesResult.data || [];

    // Sort data for better readability
    employees.sort((a, b) => {
      const numA = a.employee_number || "";
      const numB = b.employee_number || "";
      return numA.localeCompare(numB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    deductionTypes.sort((a, b) => a.name.localeCompare(b.name));
    departments.sort((a, b) => a.name.localeCompare(b.name));
    subDepartments.sort((a, b) => a.name.localeCompare(b.name));
    jobTitles.sort((a, b) => a.title.localeCompare(b.title));

    const workbook = new ExcelJS.Workbook();

    // --- MAIN SHEET ---
    const mainSheet = workbook.addWorksheet("Deductions");

    const headers = [
      { header: "Deduction Type Name", key: "type_name", width: 25 },
      { header: "Applies To", key: "applies_to", width: 20 },
      { header: "Target Identifier", key: "target", width: 35 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calc Type", key: "calc_type", width: 15 },
      { header: "Is Recurring", key: "recurring", width: 15 },
      { header: "Start Month", key: "start_month", width: 15 },
      { header: "Start Year", key: "start_year", width: 12 },
      { header: "Duration (Months)", key: "duration", width: 15 },
      { header: "Metadata JSON", key: "metadata", width: 40 },
    ];

    mainSheet.columns = headers;

    // Style header row
    const headerRow = mainSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Add sample row with instructions
    mainSheet.addRow([
      "SHIF",
      "INDIVIDUAL",
      "EMP001",
      "1700",
      "FIXED",
      "TRUE",
      "January", 
      "2024", 
      "12", 
      '{"notes": "Monthly SHIF deduction"}',
    ]);

    // Add empty rows for data entry (up to 1000 rows)
    for (let i = 3; i <= 1000; i++) {
      mainSheet.addRow([]);
    }

    // --- REFERENCE SHEET ---
    const refSheet = workbook.addWorksheet("Reference (Read Only)");

    // Style reference sheet header
    const refHeaderRow = refSheet.getRow(1);
    refHeaderRow.font = { bold: true };
    refHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFE699" },
    };

    // Add Employees section
    refSheet.getCell('A1').value = 'EMPLOYEES';
    refSheet.getCell('A2').value = 'Employee Number';
    refSheet.getCell('B2').value = 'Full Name';
    
    employees.forEach((emp, index) => {
      const rowNum = index + 3;
      refSheet.getCell(`A${rowNum}`).value = emp.employee_number;
      refSheet.getCell(`B${rowNum}`).value = `${emp.first_name} ${emp.last_name}`.trim();
    });

    // Add Departments section
    refSheet.getCell('D1').value = 'DEPARTMENTS';
    refSheet.getCell('D2').value = 'Department Name';
    
    departments.forEach((dept, index) => {
      refSheet.getCell(`D${index + 3}`).value = dept.name;
    });

    // Add Sub-Departments section
    refSheet.getCell('F1').value = 'SUB-DEPARTMENTS';
    refSheet.getCell('F2').value = 'Sub-Department Name';
    
    subDepartments.forEach((sub, index) => {
      refSheet.getCell(`F${index + 3}`).value = sub.name;
    });

    // Add Job Titles section
    refSheet.getCell('H1').value = 'JOB TITLES';
    refSheet.getCell('H2').value = 'Job Title';
    
    jobTitles.forEach((job, index) => {
      refSheet.getCell(`H${index + 3}`).value = job.title;
    });

    // Add Months reference
    refSheet.getCell('J1').value = 'MONTHS';
    refSheet.getCell('J2').value = 'Valid Months';
    
    MONTHS.forEach((month, index) => {
      refSheet.getCell(`J${index + 3}`).value = month;
    });

    // Style reference sheet columns
    refSheet.columns = [
      { width: 20 }, // A: Employee Number
      { width: 30 }, // B: Full Name
      { width: 5 },  // C: Spacer
      { width: 25 }, // D: Department Name
      { width: 5 },  // E: Spacer
      { width: 25 }, // F: Sub-Department Name
      { width: 5 },  // G: Spacer
      { width: 25 }, // H: Job Title
      { width: 5 },  // I: Spacer
      { width: 20 }, // J: Months
    ];

    // Protect reference sheet
    refSheet.protect("", {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
    });

    // --- DROPDOWNS ON MAIN SHEET ---

    // Prepare dropdown lists
    const typeNames = deductionTypes.map((t) => t.name);
    const appliesToOptions = [
      "INDIVIDUAL",
      "COMPANY",
      "DEPARTMENT",
      "SUB_DEPARTMENT",
      "JOB_TITLE",
    ];
    const employeeList = employees.map((e) => e.employee_number);
    const departmentList = departments.map((d) => d.name);
    const subDepartmentList = subDepartments.map((s) => s.name);
    const jobTitleList = jobTitles.map((j) => j.title);

    for (let i = 2; i <= 1000; i++) {
      // Deduction Type dropdown
      if (typeNames.length > 0) {
        mainSheet.getCell(`A${i}`).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [`"${typeNames.join(",")}"`],
          showErrorMessage: true,
          errorStyle: "stop",
          errorTitle: "Invalid Deduction Type",
          error: "Please select a valid deduction type from the list",
        };
      }

      // Applies To dropdown
      mainSheet.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${appliesToOptions.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Applies To",
        error:
          "Please select INDIVIDUAL, COMPANY, DEPARTMENT, SUB_DEPARTMENT, or JOB_TITLE",
      };

      // Calculation Type dropdown
      mainSheet.getCell(`E${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"FIXED,PERCENTAGE"'],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Calculation Type",
        error: "Please select FIXED or PERCENTAGE",
      };

      // Is Recurring dropdown
      mainSheet.getCell(`F${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Value",
        error: "Please select TRUE or FALSE",
      };

      // Start Month dropdown
      mainSheet.getCell(`G${i}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`"${MONTHS.join(',')}"`],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Invalid Month',
        error: `Please select a valid month from the list`
      };
    }

    // Add notes sheet
    const notesSheet = workbook.addWorksheet("Instructions");
    notesSheet.getCell("A1").value = "INSTRUCTIONS FOR BULK DEDUCTION IMPORT";
    notesSheet.getCell("A1").font = { bold: true, size: 14 };

    notesSheet.getCell("A3").value =
      '1. Use the "Deductions" sheet to enter your data';
    notesSheet.getCell("A4").value =
      '2. Use the "Reference (Read Only)" sheet to see available deduction types, employees, departments, etc.';
    notesSheet.getCell("A5").value = "3. Column explanations:";
    notesSheet.getCell("A6").value =
      "   - Deduction Type Name: Select from dropdown (based on your configured deduction types)";
    notesSheet.getCell("A7").value =
      "   - Applies To: Select who this deduction applies to (INDIVIDUAL, COMPANY, DEPARTMENT, SUB_DEPARTMENT, JOB_TITLE)";
    notesSheet.getCell("A8").value =
      "   - Target Identifier: Based on Applies To selection:";
    notesSheet.getCell("A9").value =
      "     * For INDIVIDUAL: Use Employee Number (see Reference sheet)";
    notesSheet.getCell("A10").value =
      "     * For DEPARTMENT: Use Department Name (see Reference sheet)";
    notesSheet.getCell("A11").value =
      "     * For SUB_DEPARTMENT: Use Sub-Department Name (see Reference sheet)";
    notesSheet.getCell("A12").value =
      "     * For JOB_TITLE: Use Job Title (see Reference sheet)";
    notesSheet.getCell("A13").value =
      '     * For COMPANY: Leave blank or enter "COMPANY"';
    notesSheet.getCell("A14").value =
      "   - Value: Numeric value for the deduction";
    notesSheet.getCell("A15").value =
      "   - Calc Type: FIXED (fixed amount) or PERCENTAGE (percentage of basic salary)";
    notesSheet.getCell("A16").value =
      "   - Is Recurring: TRUE (repeats monthly) or FALSE (one-time)";
    notesSheet.getCell("A17").value =
      "   - Start Month: Select from dropdown (January-December)";
    notesSheet.getCell("A18").value =
      "   - Start Year: 4-digit year (e.g., 2024)";
    notesSheet.getCell("A19").value =
      "   - Duration: For non-recurring, number of months (optional)";
      notesSheet.getCell('A20').value = '   - Metadata: JSON format for additional data (optional)';
    notesSheet.getCell("A22").value =
      "4. All fields except Duration and Metadata are required";

    // Style notes sheet
    notesSheet.columns = [{ width: 80 }];
    for (let i = 3; i <= 22; i++) {
      notesSheet.getCell(`A${i}`).font = { size: 11 };
    }

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Deduction_Import_Template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating deduction template:", error);
    res.status(500).json({ error: "Failed to generate deduction template." });
  }
};

// BULK IMPORT DEDUCTIONS
export const importDeductions = async (req, res) => {
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
        error: "Unauthorized to import deductions.",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const workbook = read(file.buffer, { type: "buffer" });

    // Get the main sheet (Deductions)
    const mainSheetName = workbook.SheetNames.find(
      (name) => name === "Deductions" || name.includes("Deduction"),
    );

    if (!mainSheetName) {
      return res.status(400).json({
        error: "Invalid template format. Please use the downloaded template.",
      });
    }

    const worksheet = workbook.Sheets[mainSheetName];

    // Use sheet_to_json with header option to get proper parsing
    const jsonData = utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "", // Default value for empty cells
      blankrows: false, // Skip completely empty rows
    });

    // Filter out empty rows and header row
    const dataRows = jsonData
      .slice(1)
      .filter(
        (row) =>
          row &&
          row.some(
            (cell) => cell !== null && cell !== undefined && cell !== "",
          ),
      );

    if (dataRows.length === 0) {
      return res
        .status(400)
        .json({ error: "No data found in the uploaded file." });
    }

    // Pre-fetch all maps for lookup
    const [employees, depts, subs, titles, types] = await Promise.all([
      supabase
        .from("employees")
        .select("id, employee_number")
        .eq("company_id", companyId),
      supabase
        .from("departments")
        .select("id, name")
        .eq("company_id", companyId),
      supabase
        .from("sub_departments")
        .select("id, name")
        .eq("company_id", companyId),
      supabase
        .from("job_titles")
        .select("id, title")
        .eq("company_id", companyId),
      supabase
        .from("deduction_types")
        .select("id, name, code")
        .eq("company_id", companyId),
    ]);

    // Check for errors
    if (
      employees.error ||
      depts.error ||
      subs.error ||
      titles.error ||
      types.error
    ) {
      throw new Error("Failed to fetch reference data");
    }

    const empMap = new Map(
      employees.data.map((e) => [e.employee_number, e.id]),
    );
    const deptMap = new Map(depts.data.map((d) => [d.name?.trim(), d.id]));
    const typeMap = new Map(
      types.data.map((t) => [t.name?.trim(), { id: t.id, code: t.code }]),
    );
    const subMap = new Map(subs.data.map((s) => [s.name?.trim(), s.id]));
    const titleMap = new Map(titles.data.map((j) => [j.title?.trim(), j.id]));

    const toInsert = [];
    const errors = [];

    for (const [index, row] of dataRows.entries()) {
      const rowNumber = index + 2; // Account for header row

      const typeName = row[0]?.toString().trim();
      const appliesTo = row[1]?.toString().trim().toUpperCase();
      const target = row[2]?.toString().trim();
      const value = row[3];
      const calculationType = row[4]?.toString().trim().toUpperCase();
      const isRecurring = row[5]?.toString().trim().toUpperCase();
       const startMonth = row[6]?.toString().trim();
      const startYear = row[7] ? parseInt(row[7].toString().trim()) : null;
      const numberOfMonths = row[8] ? parseInt(row[8].toString().trim()) : null;
      const metadataStr = row[9]?.toString().trim();

      // Skip empty rows
      if (!typeName && !appliesTo && !target && !value) {
        continue;
      }

      // Validate required fields
      const missingFields = [];
      if (!typeName) missingFields.push("Deduction Type Name");
      if (!appliesTo) missingFields.push("Applies To");
      if (appliesTo !== "COMPANY" && !target)
        missingFields.push("Target Identifier");
      if (!value) missingFields.push("Value");
      if (!calculationType) missingFields.push("Calc Type");
      if (!isRecurring) missingFields.push("Is Recurring");
      if (!startMonth) missingFields.push("Start Month");
      if (!startYear) missingFields.push("Start Year");

      if (missingFields.length > 0) {
        errors.push(
          `Row ${rowNumber}: Missing required fields: ${missingFields.join(", ")}`,
        );
        continue;
      }

      // Validate applies_to
      const validAppliesTo = [
        "INDIVIDUAL",
        "COMPANY",
        "DEPARTMENT",
        "SUB_DEPARTMENT",
        "JOB_TITLE",
      ];
      if (!validAppliesTo.includes(appliesTo)) {
        errors.push(
          `Row ${rowNumber}: Invalid Applies To value "${appliesTo}". Must be one of: ${validAppliesTo.join(", ")}`,
        );
        continue;
      }

      // Validate month
      if (!isValidMonth(startMonth)) {
        errors.push(`Row ${rowNumber}: Invalid month "${startMonth}". Must be one of: ${MONTHS.join(', ')}`);
        continue;
      }

      // Validate year
      if (isNaN(startYear) || startYear < 1900 || startYear > 2100) {
        errors.push(`Row ${rowNumber}: Invalid year "${startYear}". Must be a valid 4-digit year.`);
        continue;
      }

      // Get type info
      const typeInfo = typeMap.get(typeName);
      if (!typeInfo) {
        errors.push(
          `Row ${rowNumber}: Deduction type "${typeName}" not found.`,
        );
        continue;
      }

      // Get target ID based on applies_to
      let targetId = null;
      if (appliesTo === "INDIVIDUAL") {
        targetId = empMap.get(target);
        if (!targetId) {
          errors.push(`Row ${rowNumber}: Employee "${target}" not found.`);
          continue;
        }
      } else if (appliesTo === "DEPARTMENT") {
        targetId = deptMap.get(target);
        if (!targetId) {
          errors.push(`Row ${rowNumber}: Department "${target}" not found.`);
          continue;
        }
      } else if (appliesTo === "SUB_DEPARTMENT") {
        targetId = subMap.get(target);
        if (!targetId) {
          errors.push(
            `Row ${rowNumber}: Sub-department "${target}" not found.`,
          );
          continue;
        }
      } else if (appliesTo === "JOB_TITLE") {
        targetId = titleMap.get(target);
        if (!targetId) {
          errors.push(`Row ${rowNumber}: Job title "${target}" not found.`);
          continue;
        }
      }

      // Validate calculation type
      if (!["FIXED", "PERCENTAGE"].includes(calculationType)) {
        errors.push(
          `Row ${rowNumber}: Calculation type must be FIXED or PERCENTAGE, got "${calculationType}"`,
        );
        continue;
      }

       // Validate is_recurring
      let recurringBool;
      const recurringStr = String(isRecurring).toUpperCase();
      if (recurringStr === "TRUE" || recurringStr === "YES" || recurringStr === "1") {
        recurringBool = true;
      } else if (recurringStr === "FALSE" || recurringStr === "NO" || recurringStr === "0") {
        recurringBool = false;
      } else {
        errors.push(`Row ${rowNumber}: Is Recurring must be TRUE or FALSE, got "${isRecurring}"`);
        continue;
      }

      // Validate value is a number
      const numericValue = parseFloat(value);
      if (isNaN(numericValue) || numericValue < 0) {
        errors.push(
          `Row ${rowNumber}: Value must be a positive number, got "${value}"`,
        );
        continue;
      }

     // Validate months if provided
      if (numberOfMonths !== null && (isNaN(numberOfMonths) || numberOfMonths < 1)) {
        errors.push(`Row ${rowNumber}: Duration must be a positive number, got "${numberOfMonths}"`);
        continue;
      }

      // Parse metadata if provided
      let metadata = {};
      if (metadataStr) {
        try {
          metadata = JSON.parse(metadataStr);
        } catch (e) {
          errors.push(
            `Row ${rowNumber}: Invalid JSON in Metadata field: "${metadataStr}"`,
          );
          continue;
        }
      }

      // Calculate end month/year if applicable
      let endMonth = null;
      let endYear = null;
      if (!recurringBool && numberOfMonths) {
        const { endMonth: eMonth, endYear: eYear } = calculateEndPeriod(
          startMonth, 
          startYear, 
          numberOfMonths
        );
        endMonth = eMonth;
        endYear = eYear;
      }

      // Prepare the insert object
      toInsert.push({
        company_id: companyId,
        deduction_type_id: typeInfo.id,
        applies_to: appliesTo,
        employee_id: appliesTo === "INDIVIDUAL" ? targetId : null,
        department_id: appliesTo === "DEPARTMENT" ? targetId : null,
        sub_department_id: appliesTo === "SUB_DEPARTMENT" ? targetId : null,
        job_title_id: appliesTo === "JOB_TITLE" ? targetId : null,
        value: numericValue,
        calculation_type: calculationType,
        is_recurring: recurringBool,
        start_month: startMonth,
        start_year: startYear,
        number_of_months: numberOfMonths,
        end_month: endMonth,
        end_year: endYear,
        metadata: metadata,
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Import failed due to validation errors.",
        details: errors,
      });
    }

    if (toInsert.length === 0) {
      return res.status(400).json({ error: "No valid data to import." });
    }

    // Insert the deductions (use insert instead of upsert since we don't have a unique constraint)
    const { data, error } = await supabase
      .from("deductions")
      .insert(toInsert)
      .select();

    if (error) {
      console.error("Insert error:", error);
      throw error;
    }

    res.status(200).json({
      message: `Successfully imported ${data.length} deduction(s).`,
      count: data.length,
    });
  } catch (error) {
    console.error("Import deductions controller error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to import deductions" });
  }
};
