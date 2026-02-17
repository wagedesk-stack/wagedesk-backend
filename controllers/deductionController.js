import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
import { authorize } from "../utils/authorize.js";
const { utils, read, SSF } = pkg;

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

// Parse and validate date string (must be YYYY-MM-DD)
function parseDate(dateStr, row, fieldName, errors) {
  if (!dateStr) return null;

  // Accept string or Excel date serial number
  if (typeof dateStr === "number") {
    // Excel serial number -> JS Date
    const parsedDate = SSF.parse_date_code(dateStr);
    if (!parsedDate) {
      errors.push(`Row ${row}: Invalid date format for ${fieldName}.`);
      return null;
    }
    const jsDate = new Date(parsedDate.y, parsedDate.m - 1, parsedDate.d);
    return jsDate.toISOString().split("T")[0];
  }

  if (typeof dateStr === "string") {
    const regex = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
    if (!regex.test(dateStr)) {
      errors.push(
        `Row ${row}: Invalid date format for ${fieldName}. Use YYYY-MM-DD.`,
      );
      return null;
    }
    return new Date(dateStr).toISOString().split("T")[0];
  }

  errors.push(`Row ${row}: Could not parse date for ${fieldName}.`);
  return null;
}

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
    start_date,
    number_of_months,
    metadata = {},
  } = req.body;

  // 1. Auto-calculate end_date if duration is provided
  let end_date = null;
  if (!is_recurring && number_of_months && start_date) {
    const start = new Date(start_date);
    start.setMonth(start.getMonth() + parseInt(number_of_months));
    end_date = start.toISOString().split('T')[0];
  }

  const payload = {
    company_id: companyId,
    deduction_type_id,
    applies_to,
    value,
    calculation_type,
    is_recurring,
    start_date,
    number_of_months,
    end_date,
    metadata,
    // Targeting Logic: Nullify irrelevant IDs based on applies_to
    employee_id: applies_to === 'INDIVIDUAL' ? employee_id : null,
    department_id: applies_to === 'DEPARTMENT' ? department_id : null,
    sub_department_id: applies_to === 'SUB_DEPARTMENT' ? sub_department_id : null,
    job_title_id: applies_to === 'JOB_TITLE' ? job_title_id : null,
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

    const { data, error } = await supabase.from("deductions").insert([payload]).select().single();
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
      .select(`
        *, 
        deduction_types(name, code, is_pre_tax), 
        employees(first_name, last_name), 
        departments(name),
        sub_departments(name),
        job_titles(title)
      `)
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
      .select("*")
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
    start_date,
    number_of_months,
    metadata,
  } = req.body;

  let end_date = null;
  if (is_recurring && number_of_months && start_date) {
    const start = new Date(start_date);
    start.setMonth(start.getMonth() + parseInt(number_of_months));
    end_date = start.toISOString().split('T')[0];
  }

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
      .update({
        value,
        calculation_type,
        is_recurring,
        start_date,
        number_of_months,
        end_date,
        metadata,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
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
    res.json({ message: "Deduction removed" });
  } catch (err) {
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

    // Fetch required data from the database
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("employee_number, first_name, last_name")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const { data: deductionTypes, error: deductionTypeError } = await supabase
      .from("deduction_types")
      .select("name")
      .eq("company_id", companyId);
    if (deductionTypeError) throw deductionTypeError;

    // Sort employees by employee_number
    employees.sort((a, b) => {
      const codeA = a.employee_number || "";
      const codeB = b.employee_number || "";
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Deductions");

    const headers = [
      { header: "Employee Number", key: "employee_number", width: 20 },
      { header: "Deduction Name", key: "deduction_name", width: 20 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calculation Type", key: "calculation_type", width: 20 },
      { header: "Is Recurring (true/false)", key: "is_recurring", width: 25 },
      { header: "Start Month (e.g., January)", key: "start_month", width: 25 },
      { header: "Start Year (e.g., 2024)", key: "start_year", width: 25 },
      { header: "End Month (Optional)", key: "end_month", width: 25 },
      { header: "End Year (Optional)", key: "end_year", width: 25 },
    ];

    worksheet.columns = headers;
    worksheet.getRow(1).font = { bold: true };

    // --- Dropdown Setup ---
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

    // Add dropdowns for 'Deduction Name', 'Calculation Type', 'Is Active', and 'Is One-Time'
    const deductionNames = deductionTypes.map((type) => type.name);
    const calculationTypes = ["Fixed", "Percentage"];
    const isTrueFalse = ["true", "false"];

    employees.forEach((employee) => {
      worksheet.addRow([employee.employee_number]);
    });

    // Add dropdowns to each cell in the relevant columns (B-I)
    for (let i = 2; i <= 1000; i++) {
      // Deduction Name
      worksheet.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${deductionNames.join(",")}"`],
      };
      // Calculation Type
      worksheet.getCell(`D${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${calculationTypes.join(",")}"`],
      };
      // Is Recurring
      worksheet.getCell(`E${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${isTrueFalse.join(",")}"`],
      };
      // Start Month
      worksheet.getCell(`F${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${monthNames.join(",")}"`],
      };
      // End Month
      worksheet.getCell(`H${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${monthNames.join(",")}"`],
      };
      // Note: Start Year (G) and End Year (I) should remain free text/number fields for flexibility.
    }

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

  const isValidMonth = (month) => monthNames.includes(month);

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
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = utils.sheet_to_json(worksheet);

    const errors = [];
    const deductionsToUpsert = [];

    // Fetch employee IDs and deduction type IDs for validation
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("id, employee_number")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const employeeMap = new Map(
      employees.map((emp) => [emp.employee_number, emp.id]),
    );

    const { data: deductionTypes, error: deductionTypeError } = await supabase
      .from("deduction_types")
      .select("id, name")
      .eq("company_id", companyId);
    if (deductionTypeError) throw deductionTypeError;

    const deductionTypeMap = new Map(
      deductionTypes.map((type) => [type.name, type.id]),
    );

    for (const [index, row] of jsonData.entries()) {
      const rowNumber = index + 2;
      const employeeNumber = row["Employee Number"];
      const deductionName = row["Deduction Name"];
      const value = row["Value"];
      const calculationType = row["Calculation Type"];
      const isRecurring = row["Is Recurring (true/false)"];
      const startMonth = row["Start Month (e.g., January)"];
      const startYear = row["Start Year (e.g., 2024)"];
      const endMonth = row["End Month (Optional)"] || null;
      const endYear = row["End Year (Optional)"] || null;

      // Validation logic
      if (
        !employeeNumber ||
        !deductionName ||
        !value ||
        !calculationType ||
        !startMonth ||
        !startYear ||
        isRecurring === undefined
      ) {
        errors.push(`Row ${rowNumber}: Required fields are missing.`);
        continue;
      }

      const employeeId = employeeMap.get(String(employeeNumber).trim());
      if (!employeeId) {
        errors.push(`Row ${rowNumber}: Invalid Employee Number.`);
      }

      const deductionTypeId = deductionTypeMap.get(
        String(deductionName).trim(),
      );
      if (!deductionTypeId) {
        errors.push(`Row ${rowNumber}: Invalid Deduction Name.`);
      }

      if (!["Fixed", "Percentage"].includes(String(calculationType).trim())) {
        errors.push(
          `Row ${rowNumber}: Invalid Calculation Type. Must be 'Fixed' or 'Percentage'.`,
        );
      }

      // New Month/Year Validation
      if (!isValidMonth(String(startMonth).trim())) {
        errors.push(`Row ${rowNumber}: Invalid Start Month.`);
      }
      if (isNaN(parseInt(startYear)) || parseInt(startYear) < 1900) {
        errors.push(`Row ${rowNumber}: Invalid Start Year.`);
      }

      if (endMonth && !isValidMonth(String(endMonth).trim())) {
        errors.push(`Row ${rowNumber}: Invalid End Month.`);
      }
      if (endYear && (isNaN(parseInt(endYear)) || parseInt(endYear) < 1900)) {
        errors.push(`Row ${rowNumber}: Invalid End Year.`);
      }

      if (errors.length === 0) {
        deductionsToUpsert.push({
          company_id: companyId,
          deduction_type_id: deductionTypeId,
          employee_id: employeeId,
          value: parseFloat(value),
          calculation_type: String(calculationType).trim(),
          is_recurring: String(isRecurring).trim().toLowerCase() === "true",
          start_month: String(startMonth).trim(),
          start_year: parseInt(startYear),
          end_month: endMonth ? String(endMonth).trim() : null,
          end_year: endYear ? parseInt(endYear) : null,
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Import failed due to validation errors.",
        details: errors,
      });
    }

    // Use upsert to handle new entries and updates for existing ones.
    const { data, error } = await supabase
      .from("deductions")
      .upsert(deductionsToUpsert, {
        onConflict: "employee_id, deduction_type_id, company_id",
      })
      .select();

    if (error) {
      console.error("Bulk upsert deductions error:", error);
      return res.status(500).json({ error: "Failed to import deductions." });
    }

    res.status(200).json({
      message: "Deductions imported successfully!",
      count: data.length,
    });
  } catch (error) {
    console.error("Import deductions controller error:", error);
    res.status(500).json({ error: error.message });
  }
};
