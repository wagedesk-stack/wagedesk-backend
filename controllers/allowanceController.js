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
export const assignAllowance = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    allowance_type_id,
    applies_to,
    employee_id,
    department_id,
    sub_department_id,
    job_title_id,
    value,
    calculation_type,
    is_recurring,
    start_date,
    number_of_months,
    metadata = {},
  } = req.body;

  // 1. Auto-calculate end_date if duration is provided
  let end_date = null;
  if (is_recurring && number_of_months && start_date) {
    const start = new Date(start_date);
    start.setMonth(start.getMonth() + parseInt(number_of_months));
    end_date = start.toISOString().split('T')[0];
  }

  const payload = {
    company_id: companyId,
    allowance_type_id,
    applies_to,
    value,
    calculation_type,
    is_recurring,
    start_date,
    number_of_months,
    end_date,
    metadata,
    // Clear other IDs based on applies_to to ensure data integrity
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
        error: "Unauthorized to assign allowance.",
      });
    }

    const { data, error } = await supabase.from("allowances").insert([payload]).select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to assign allowance" });
  }
};

// GET ALL
export const getAllowances = async (req, res) => {
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
        error: "Unauthorized to view allowances.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select(
        "*, allowance_types(name, is_cash, is_taxable), employees(first_name, last_name)",
      )
      .eq("company_id", companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch allowances" });
  }
};

// GET ONE
export const getAllowanceById = async (req, res) => {
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
        error: "Unauthorized to view allowances.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: "Allowance not found" });
  }
};

// UPDATE
export const updateAllowance = async (req, res) => {
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
        error: "Unauthorized to update allowance.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .update({
        value,
        calculation_type,
        is_recurring,
        start_date,
        number_of_months,
        end_date,
        metadata
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to update allowance" });
  }
};

// REMOVE
export const removeAllowance = async (req, res) => {
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
        error: "Unauthorized to delete allowance.",
      });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw error;
    res.json({ message: "Allowance removed" });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove allowance" });
  }
};

//bulk delete
export const bulkDeleteAllowances = async (req, res) => {
  const { companyId } = req.params;
  const { allowanceIds } = req.body; // Expecting an array of allowance IDs
  const userId = req.userId;

  if (
    !allowanceIds ||
    !Array.isArray(allowanceIds) ||
    allowanceIds.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "No allowance IDs provided for deletion." });
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
        error: "Unauthorized to delete allowances.",
      });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .in("id", allowanceIds)
      .eq("company_id", companyId);
    if (error) {
      console.error("Bulk delete allowances error:", error);
      return res.status(500).json({ error: "Failed to remove allowances" });
    }

    res
      .status(200)
      .json({
        message: `${allowanceIds.length} allowance(s) deleted successfully.`,
      });
  } catch (err) {
    console.error("Bulk delete allowances controller error:", err);
    res
      .status(500)
      .json({ error: "An unexpected error occurred during bulk deletion." });
  }
};

// GENERATE TEMPLATE FOR BULK ALLOWANCE IMPORT
export const generateAllowanceTemplate = async (req, res) => {
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
        error: "Unauthorized to view allowances.",
      });
    }

    // Fetch required data from the database
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("employee_number, first_name, last_name")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const { data: allowanceTypes, error: allowanceTypeError } = await supabase
      .from("allowance_types")
      .select("name, code")
      .eq("company_id", companyId);

    if (allowanceTypeError) throw allowanceTypeError;

    //Sort with employee number ascending
    employees.sort((a, b) => {
      const codeA = a.employee_number || "";
      const codeB = b.employee_number || "";
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Allowances");

    const headers = [
      { header: "Allowance Type Name", key: "type_name", width: 25 },
      { header: "Applies To", key: "applies_to", width: 20 },
      { header: "Target Identifier (Emp#, Dept Name, etc)", key: "target", width: 35 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calc Type (FIXED/PERCENTAGE)", key: "calc_type", width: 20 },
      { header: "Is Recurring (TRUE/FALSE)", key: "recurring", width: 20 },
      { header: "Start Date (YYYY-MM-DD)", key: "start", width: 20 },
      { header: "Months (Optional)", key: "months", width: 15 },
      { header: "Metadata JSON (e.g. {'cc': 2000})", key: "metadata", width: 40 },
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

    // Add dropdowns for 'Allowance Name' and 'Calculation Type'
   const typeNames = allowanceTypes.map(t => t.name);
    const appliesToOptions = ["INDIVIDUAL", "COMPANY", "DEPARTMENT", "SUB_DEPARTMENT", "JOB_TITLE"];
    const calculationTypes = ["Fixed", "Percentage"];
    const isTrueFalse = ["true", "false"];

    employees.forEach((employee) => {
      worksheet.addRow([employee.employee_number]);
    });

    // Add dropdowns to each cell in the relevant columns (B-I)
  // Add validation for 500 rows
    for (let i = 2; i <= 1000; i++) {
      worksheet.getCell(`A${i}`).dataValidation = { type: 'list', formulae: [`"${typeNames.join(',')}"`] };
      worksheet.getCell(`B${i}`).dataValidation = { type: 'list', formulae: [`"${appliesToOptions.join(',')}"`] };
      worksheet.getCell(`E${i}`).dataValidation = { type: 'list', formulae: ['"FIXED,PERCENTAGE"'] };
      worksheet.getCell(`F${i}`).dataValidation = { type: 'list', formulae: ['"TRUE,FALSE"'] };
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Allowance_Import_Template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating allowance template:", error);
    res.status(500).json({ error: "Failed to generate allowance template." });
  }
};

// BULK IMPORT ALLOWANCES
export const importAllowances = async (req, res) => {
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
        error: "Unauthorized to import allowances.",
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

  // Pre-fetch all maps for lookup
    const [employees, depts, subs, titles, types] = await Promise.all([
      supabase.from("employees").select("id, employee_number").eq("company_id", companyId),
      supabase.from("departments").select("id, name").eq("company_id", companyId),
      supabase.from("sub_departments").select("id, name").eq("company_id", companyId),
      supabase.from("job_titles").select("id, title").eq("company_id", companyId),
      supabase.from("allowance_types").select("id, name, code").eq("company_id", companyId)
    ]);

    const empMap = new Map(employees.data.map(e => [e.employee_number, e.id]));
    const deptMap = new Map(depts.data.map(d => [d.name, d.id]));
    const typeMap = new Map(types.data.map(t => [t.name, { id: t.id, code: t.code }]));
      const subMap = new Map(subs.data.map(s => [s.name, s.id]));
    const titleMap = new Map(titles.data.map(j => [j.title, j.id]));

    const toInsert = [];
    const errors = [];

    for (const [index, row] of jsonData.entries()) {
      const rowNumber = index + 2; // Account for header row
     const typeInfo = typeMap.get(row["Allowance Type Name"]);
     const appliesTo = row["Applies To"];
      const target = String(row["Target Identifier (Emp#, Dept Name, etc)"]);
      const value = row["Value"];
      const calculationType = row["Calculation Type"];
      const isRecurring = row["Is Recurring (true/false)"];
      const startMonth = row["Start Month (e.g., January)"];
      const startYear = row["Start Year (e.g., 2024)"];
      const endMonth = row["End Month (Optional)"] || null;
      const endYear = row["End Year (Optional)"] || null;

      let targetId = null;
      if (appliesTo === "INDIVIDUAL") targetId = empMap.get(target);
      else if (appliesTo === "DEPARTMENT") targetId = deptMap.get(target);
      else if (appliesTo === "SUB_DEPARTMENT") targetId = subMap.get(target);
      else if (appliesTo === "JOB_TITLE") targetId = titleMap.get(target);
      //else if (appliesTo === "COMPANY") targetId = null; // No target ID for company-wide

      // Validation logic
      if (
        !targetId ||
        !typeInfo ||
        !value ||
        !calculationType ||
        !start_date ||
        isRecurring === undefined
      ) {
        errors.push(`Row ${rowNumber}: Required fields are missing.`);
        continue;
      }


      if (errors.length === 0) {
      toInsert.push({
        company_id: companyId,
        allowance_type_id: typeInfo?.id,
        applies_to: appliesTo,
        employee_id: appliesTo === "INDIVIDUAL" ? targetId : null,
        department_id: applies_to === "DEPARTMENT" ? targetId : null,
        value: parseFloat(row["Value"]),
        calculation_type: row["Calc Type (FIXED/PERCENTAGE)"],
        is_recurring: String(row["Is Recurring (TRUE/FALSE)"]).toLowerCase() === "true",
        start_date: row["Start Date (YYYY-MM-DD)"],
        number_of_months: parseInt(row["Months (Optional)"]) || null,
        metadata: meta
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
    // The conflict target is the unique constraint on (employee_id, allowance_type_id, company_id)
    const { data, error } = await supabase.from("allowances").insert(toInsert).select();
    if (error) throw error;

    res.status(200).json({
      message: "Allowances imported successfully!",
      count: data.length,
    });
  } catch (error) {
    console.error("Import allowances controller error:", error);
    res.status(500).json({ error: error.message });
  }
};
