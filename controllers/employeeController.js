// backend/controllers/employeeController.js
import supabase from "../libs/supabaseClient.js";
import { sendEmailService } from "../services/email.js";
import { dispatchEmail } from "../services/resendService.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
import { authorize } from "../utils/authorize.js";
//import { sendEmail } from "../services/email.js";
const { utils, read, SSF } = pkg;

// -------------------- Helper Functions -------------------- //

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

// Normalize Yes/No → boolean
function parseYesNo(value) {
  if (!value) return false;
  return value.toString().trim().toLowerCase() === "yes";
}

// Normalize No/Yes → inverted boolean (for fields like pays_paye)
function parseNoDefaultYes(value) {
  if (!value) return true; // default = yes
  return value.toString().trim().toLowerCase() !== "no";
}

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
// ----  Function to send email ----

// -------------------- Employee Controllers -------------------- //

// Get all employees for a specific company
export const getEmployees = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view employees.",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .select(
        `
    *,
    departments (id, name),
    sub_departments (id, name),
    job_titles (id, title),
    employee_payment_details (*),
    employee_contracts (*)
  `,
      )
      .eq("company_id", companyId)
      .order("created_at", {
        foreignTable: "employee_contracts",
        ascending: false,
      });

    if (error) {
      console.error("Fetch employees error:", error);
      throw new Error("Failed to fetch employees.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// send emails
export const sendEmployeeEmail = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { recipients, subject, body } = req.body;

  if (!recipients?.length || !subject || !body) {
    return res.status(400).json({ error: "Missing email fields" });
  }

  try {
    // 1 Verify company
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to send emails.",
      });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, business_name, workspace_id")
      .eq("id", companyId)
      .single();

      if (companyError || !company) {
      return res.status(403).json({ error: "Company not found" });
    }

    const htmlContent = `
      <div style="font-family: sans-serif; color: #334155; line-height: 1.6;">
        <h2 style="color: #0f172a;">Sent from ${company.business_name} via WageDesk</h2>
        <div style="border-left: 4px solid #6366f1; padding-left: 16px; margin: 20px 0;">
          ${body}
        </div>
        <p style="font-size: 12px; color: #94a3b8;">
          This is an automated message .
        </p>
      </div>
    `;
    /*
    const result = await dispatchEmail({
      to: recipients,
      subject,
      html: htmlContent,
      text: body, // Fallback text version
    });*/

    // 3️ Send emails (rate-limited for free tier)
    for (const email of recipients) {
      await sendEmailService({
        to: email,
        subject,
        html: htmlContent,
        text: body,
        company: company.business_name,
      });

      // ⏱ Delay to avoid SMTP throttling (FREE TIER SAFE)
      await new Promise((r) => setTimeout(r, 1200));
    }

    res.status(200).json({
      success: true,
      sent: recipients.length,
      //messageId: result.id
    });
  } catch (emailError) {
  console.error("Send email error:", emailError.message);
  res.status(500).json({ error: "Failed to send emails" });
}

};
// Get a single employee by ID
export const getEmployeeById = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view employee(s).",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .select(
        `
    *,
    departments (id, name),
    sub_departments (id, name),
    job_titles (id, title),
    employee_payment_details (*),
    employee_contracts (*)
  `,
      )
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (error) {
      console.error("Fetch employee by ID error:", error);
      if (error.code === "PGRST116") {
        // No rows found
        return res.status(404).json({ error: "Employee not found." });
      }
      throw new Error("Failed to fetch employee details.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add a new employee
export const addEmployee = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { bank_details, contract_details, ...employeeData } = req.body;

  if (
    !employeeData.employee_number ||
    !employeeData.first_name ||
    !employeeData.last_name ||
    !employeeData.salary
  ) {
    return res.status(400).json({ error: "Required fields are missing." });
  }

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to Add employee(s).",
      });
    }

    const { data: newEmployee, error: empError } = await supabase
      .from("employees")
      .insert({ ...employeeData, company_id: companyId })
      .select()
      .single();

    if (empError) {
      console.error("Insert employee error:", empError);
      if (empError.code === "23505") {
        // Unique violation error (e.g., employee_number, KRA PIN, ID number, email)
        return res.status(409).json({
          error:
            "An employee with similar unique details (Employee No., ID, KRA PIN, Email) already exists.",
        });
      }
      throw new Error("Failed to add employee.");
    }

    // 3. Insert Payment Details
    if (bank_details) {
      await supabase.from("employee_payment_details").insert({
        ...bank_details,
        employee_id: newEmployee.id,
      });
    }

    // 4. Insert Contract Details
    if (contract_details) {
      await supabase.from("employee_contracts").insert({
        ...contract_details,
        employee_id: newEmployee.id,
      });
    }

    res.status(201).json(newEmployee);
  } catch (error) {
    console.error("Add employee controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update an existing employee (full update)
export const updateEmployee = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const { bank_details, contract_details, ...employeeData } = req.body;

  const validatedDepartmentId =
    employeeData.department_id === "" ? null : employeeData.department_id;

  if (
    !employeeData.employee_number ||
    !employeeData.first_name ||
    !employeeData.last_name ||
    !employeeData.salary
  ) {
    return res.status(400).json({ error: "Required fields are missing." });
  }

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to Edit employee(s).",
      });
    }

    // Ensure the user owns the company and the employee belongs to that company
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({
        department_id: validatedDepartmentId,
        ...employeeData,
      })
      .eq("id", employeeId)
      .eq("company_id", companyId) // Ensure only employee for this company is updated
      .select()
      .single();

    if (error) {
      console.error("Update employee error:", error);
      if (error.code === "23505") {
        return res.status(409).json({
          error: "An employee with similar unique details already exists.",
        });
      }
      throw new Error("Failed to update employee.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete an employee
export const deleteEmployee = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_delete",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete employee(s).",
      });
    }

    // Ownership checks similar to updateEmployee
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", employeeId)
      .eq("company_id", companyId);

    if (error) {
      console.error("Delete employee error:", error);
      throw new Error("Failed to delete employee.");
    }

    res.status(204).send(); // No Content
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const importEmployees = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  try {
   const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to bulk import.",
      });
    }

    // Get all departments, subs and titles for validation
    const [deptsRes, subDeptsRes, titlesRes] = await Promise.all([
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
    ]);

    if (deptsRes.error || subDeptsRes.error || titlesRes.error) {
      console.error(
        "Fetch depts, sub-depts and titles error:",
        deptsRes.error || subDeptsRes.error || titlesRes.error,
      );
      throw new Error("Fetch depts, sub-depts and titles error ");
    }

    const departments = deptsRes.data ?? [];
    const subDepartments = subDeptsRes.data ?? [];
    const jobTitles = titlesRes.data ?? [];

    const departmentMap = departments.reduce((acc, d) => {
      acc[d.name.toLowerCase()] = d.id;
      return acc;
    }, {});

    const subDepartmentMap = subDepartments.reduce((acc, s) => {
      acc[s.name.toLowerCase()] = s.id;
      return acc;
    }, {});

    const jobTitleMap = jobTitles.reduce((acc, j) => {
      acc[j.title.toLowerCase()] = j.id;
      return acc;
    }, {});

    // Parse Excel
    const workbook = read(req.file.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    const headers = jsonData[0].map((h) => (h || "").trim());
    const employeesToInsert = [];
    const errors = [];
    const uniqueValues = {
      employee_number: new Set(),
      email: new Set(),
      id_number: new Set(),
      krapin: new Set(),
    };

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const employeeData = {};
      headers.forEach((header, index) => {
        const key = header.replace(/\s/g, "_").toLowerCase();
        employeeData[key] = row[index];
      });

      // Required fields
      if (
        !employeeData.employee_number ||
        !employeeData.first_name ||
        !employeeData.last_name ||
        !employeeData.salary
      ) {
        errors.push(
          `Row ${
            i + 1
          }: Missing required fields (Employee Number, First Name, Last Name, Salary).`,
        );
        continue;
      }

      // Check uniqueness
      ["employee_number", "email", "id_number"].forEach((field) => {
        const val = employeeData[field];
        if (val) {
          if (uniqueValues[field].has(val)) {
            errors.push(`Row ${i + 1}: Duplicate value for '${field}'.`);
          } else {
            uniqueValues[field].add(val);
          }
        }
      });

      // Correctly check for KRA PIN uniqueness using the correct key.
      const kraPinVal = employeeData.kra_pin;
      if (kraPinVal) {
        if (uniqueValues.krapin.has(kraPinVal)) {
          errors.push(`Row ${i + 1}: Duplicate value for 'kra_pin'.`);
        } else {
          uniqueValues.krapin.add(kraPinVal);
        }
      }

      // Map department
      let departmentId = null;
      if (employeeData.department) {
        const deptKey = employeeData.department.toLowerCase();
        departmentId = departmentMap[deptKey];
        if (!departmentId) {
          errors.push(
            `Row ${i + 1}: Department '${employeeData.department}' not found.`,
          );
        }
      }

      // Map sub department
      let subDepartmentId = null;
      if (employeeData.sub_department) {
        const subDeptKey = employeeData.sub_department.toLowerCase();
        subDepartmentId = subDepartmentMap[subDeptKey];
        if (!subDepartmentId) {
          errors.push(
            `Row ${i + 1}:  Sub Department '${employeeData.sub_department}' not found.`,
          );
        }
      }

      // Map job titles
      let jobTitleId = null;
      if (employeeData.job_title) {
        const titletKey = employeeData.job_title.toLowerCase();
        jobTitleId = jobTitleMap[titletKey];
        if (!jobTitleId) {
          errors.push(
            `Row ${i + 1}: Job Title '${employeeData.job_title}' not found.`,
          );
        }
      }

      // Build employee record
      const record = {
        company_id: companyId,
        department_id: employeeData.department
          ? departmentMap[employeeData.department.toLowerCase()] || null
          : null,
        sub_department_id: employeeData.sub_department
          ? subDepartmentMap[employeeData.sub_department.toLowerCase()] || null
          : null,
        job_title_id: employeeData.job_title
          ? jobTitleMap[employeeData.job_title.toLowerCase()] || null
          : null,
        employee_number: employeeData.employee_number.toString(),
        first_name: employeeData.first_name,
        middle_name: employeeData.middle_name || null,
        last_name: employeeData.last_name,
        email: employeeData.email || null,
        phone: employeeData.phone || null,
        date_of_birth: employeeData["date_of_birth_(yyyy-mm-dd)"]
          ? parseDate(
              employeeData["date_of_birth_(yyyy-mm-dd)"],
              i + 1,
              "Date of Birth",
              errors,
            )
          : null,
        gender: ["male", "female", "other"].includes(
          employeeData.gender?.toLowerCase(),
        )
          ? employeeData.gender
          : null,
        blood_group: [
          "A+",
          "A-",
          "B+",
          "B-",
          "O+",
          "O-",
          "AB+",
          "AB-",
        ].includes(employeeData.blood_group?.toLowerCase())
          ? employeeData.blood_group
          : null,
        marital_status: [
          "Single (never married)",
          "Married",
          "Divorced",
          "Widowed",
          "Separated",
        ].includes(employeeData.marital_status?.toLowerCase())
          ? employeeData.marital_status
          : null,
        hire_date: employeeData["hire_date_(yyyy-mm-dd)"]
          ? parseDate(
              employeeData["hire_date_(yyyy-mm-dd)"],
              i + 1,
              "Hire Date",
              errors,
            )
          : new Date().toISOString().split("T")[0],
        job_type: ["full-time", "part-time", "contract", "internship"].includes(
          employeeData.job_type?.toLowerCase(),
        )
          ? employeeData.job_type
          : null,
        employee_status: [
          "active",
          "on leave",
          "terminated",
          "suspended",
        ].includes(employeeData.employee_status?.toLowerCase())
          ? employeeData.employee_status
          : "Active",
        employee_status_effective_date: employeeData[
          "employee_status_effective_date_(yyyy-mm-dd)"
        ]
          ? parseDate(
              employeeData["employee_status_effective_date_(yyyy-mm-dd)"],
              i + 1,
              "Employee Status Effective Date",
              errors,
            )
          : new Date().toISOString().split("T")[0],
        id_type: ["national id", "passport"].includes(
          employeeData.id_type?.toLowerCase(),
        )
          ? employeeData.id_type
          : null,
        id_number: employeeData.id_number?.toString() || null,
        krapin: employeeData.kra_pin
          ? String(employeeData.kra_pin).trim()
          : null,
        shif_number: employeeData.shif_number?.toString() || null,
        nssf_number: employeeData.nssf_number?.toString() || null,
        citizenship: ["kenyan", "non-kenyan"].includes(
          employeeData.citizenship?.toLowerCase(),
        )
          ? employeeData.citizenship || "Kenyan"
          : null,
        has_disability: parseYesNo(employeeData.has_disability),
        employee_type: [
          "primary employee",
          "secondary employee",
          "consultant",
        ].includes(employeeData.employee_type?.toLowerCase())
          ? employeeData.employee_type || "Primary Employee"
          : null,
        pays_paye: parseNoDefaultYes(employeeData.pays_paye),
        pays_nssf: parseNoDefaultYes(employeeData.pays_nssf),
        pays_helb: parseYesNo(employeeData.pays_helb),
        pays_housing_levy: parseNoDefaultYes(employeeData.pays_housing_levy),
        pays_shif: parseNoDefaultYes(employeeData.pays_shif),
        salary: parseFloat(employeeData.salary) || 0,
      };

      // 2. Prepare Payment Details for this row
      const paymentDetail = {
        payment_method: (employeeData.payment_method || "CASH").toUpperCase(),
        bank_name: employeeData.bank_name || null,
        bank_code: employeeData.bank_code?.toString() || null,
        branch_name: employeeData.branch_name || null,
        branch_code: employeeData.branch_code?.toString() || null,
        account_number: employeeData.account_number?.toString() || null,
        account_name: employeeData.account_name || null,
        mobile_type: employeeData.mobile_type || null,
        phone_number: employeeData.phone_number?.toString() || null,
      };

      // 3. Prepare Contract Details for this row
      const contractDetail = {
        contract_type:
          employeeData.contract_type || "Permanent and Pensionable",
        start_date: employeeData["start_date_(yyyy-mm-dd)"]
          ? parseDate(
              employeeData["start_date_(yyyy-mm-dd)"],
              i + 1,
              "Start Date",
              errors,
            )
          : record.date_joined,
        end_date: employeeData["end_date_(yyyy-mm-dd)"]
          ? parseDate(
              employeeData["end_date_(yyyy-mm-dd)"],
              i + 1,
              "End Date",
              errors,
            )
          : null,
        probation_end_date: employeeData["probation_end_date_(yyyy-mm-dd)"]
          ? parseDate(
              employeeData["probation_end_date_(yyyy-mm-dd)"],
              i + 1,
              "Probation End Date",
              errors,
            )
          : null,
        contract_status: (
          employeeData.contract_status || "ACTIVE"
        ).toUpperCase(),
      };

      employeesToInsert.push({ record, paymentDetail, contractDetail });
    }

    if (errors.length > 0) {
      return res
        .status(400)
        .json({ error: "Validation failed.", details: errors });
    }

    // 1. Upsert Main Employee Recordss
    const coreRecords = employeesToInsert.map((e) => e.record);
    const { data: insertedEmployees, error: empError } = await supabase
      .from("employees")
      .upsert(coreRecords, {
        onConflict: "company_id, employee_number",
        ignoreDuplicates: false,
      })
      .select("id, employee_number");

    if (empError) {
      console.error("Bulk upsert employee error:", empError);
      // Handle unique constraint errors if they still occur from existing DB data
      if (empError.code === "23505") {
        const uniqueKey = empError.details.match(/\((.*?)\)=\(.*?\)/)[1];
        return res.status(409).json({
          error: `A record with a duplicate unique key already exists in the database: ${uniqueKey}.`,
        });
      }
      return res.status(500).json({
        error: "Failed to import employees.",
        details: empError.message,
      });
    }

    // Map the returned UUIDs back to our original data using employee_number as the key
    const paymentRecords = [];
    const contractRecords = [];

    insertedEmployees.forEach((emp) => {
      const originalData = employeesToInsert.find(
        (e) => e.record.employee_number === emp.employee_number,
      );

      if (originalData) {
        paymentRecords.push({
          ...originalData.paymentDetail,
          employee_id: emp.id,
        });
        contractRecords.push({
          ...originalData.contractDetail,
          employee_id: emp.id,
        });
      }
    });

    // 2. Upsert Payment Details
    const { error: bankError } = await supabase
      .from("employee_payment_details")
      .upsert(paymentRecords, { onConflict: "employee_id" });

    // 3. Upsert Contract Details
    for (const contract of contractRecords) {
      // Check if we're trying to insert an ACTIVE contract
      if (contract.contract_status === "ACTIVE") {
        // First, check if there's already an active contract
        const { data: existingActive } = await supabase
          .from("employee_contracts")
          .select("id")
          .eq("employee_id", contract.employee_id)
          .eq("contract_status", "ACTIVE")
          .maybeSingle();

        if (existingActive) {
          // Update existing active contract to EXPIRED
          await supabase
            .from("employee_contracts")
            .update({
              contract_status: "EXPIRED",
              end_date: contract.start_date, // or new Date()
            })
            .eq("id", existingActive.id);
        }

        // Now insert the new active contract
        const { error: contractError } = await supabase
          .from("employee_contracts")
          .insert(contract);

        if (contractError) {
          console.error(
            `Contract error for employee ${contract.employee_id}:`,
            contractError,
          );
          errors.push(
            `Failed to insert contract for employee ${contract.employee_id}`,
          );
        }
      } else {
        // For non-active contracts, just insert (no constraint issue)
        const { error: contractError } = await supabase
          .from("employee_contracts")
          .insert(contract);

        if (contractError) {
          console.error(
            `Contract error for employee ${contract.employee_id}:`,
            contractError,
          );
          errors.push(
            `Failed to insert contract for employee ${contract.employee_id}`,
          );
        }
      }
    }

    if (bankError) {
      console.error("Sub-table insert error:", bankError);
      return res.status(500).json({
        error: "Bank details update failed",
        details: bankError.message,
      });
    }

    res.status(201).json({
      message: `${insertedEmployees.length} employees imported successfully.`,
      importedEmployees: insertedEmployees,
    });
  } catch (err) {
    console.error("Import employees controller error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const generateEmployeeTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
   const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "EMPLOYEES",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to download template.",
      });
    }

    // 2. Fetch departments, sub departments and job titles from Supabase
    const [deptsRes, subDeptsRes, titlesRes] = await Promise.all([
      supabase.from("departments").select("name").eq("company_id", companyId),
      supabase
        .from("sub_departments")
        .select("name")
        .eq("company_id", companyId),
      supabase.from("job_titles").select("title").eq("company_id", companyId),
    ]);

    if (deptsRes.error || subDeptsRes.error || titlesRes.error) {
      throw new Error("Failed to load dropdown metadata");
    }

    const departments = deptsRes.data ?? [];
    const subDepartments = subDeptsRes.data ?? [];
    const jobTitles = titlesRes.data ?? [];
    // --- HEADERS ---
    const templateHeaders = [
      "Employee Number",
      "First Name",
      "Middle Name",
      "Last Name",
      "Email",
      "Phone",
      "Date of Birth (YYYY-MM-DD)",
      "Gender",
      "Blood Group",
      "Marital Status",
      "Hire Date (YYYY-MM-DD)",
      "Department",
      "Sub Department",
      "Job Title",
      "Job Type",
      "Employee Status",
      "Employee Status Effective Date (YYYY-MM-DD)",
      "ID Type",
      "ID Number",
      "KRA PIN",
      "SHIF Number",
      "NSSF Number",
      "Citizenship",
      "Has Disability",
      "Salary",
      "Employee Type",
      "Pays PAYE",
      "Pays NSSF",
      "Pays HELB",
      "Pays Housing Levy",
      "Pays SHIF",
      "Contract Type",
      "Start Date (YYYY-MM-DD)",
      "End Date (YYYY-MM-DD) ",
      "Probation End Date (YYYY-MM-DD)",
      "Contract Status",
      "Payment Method",
      "Bank Name",
      "Bank Code",
      "Branch Name",
      "Branch Code",
      "Account Number",
      "Account Name",
      "Mobile Type",
      "Phone Number",
    ];

    // --- DROPDOWNS ---
    const dropdownOptions = {
      Gender: ["Male", "Female", "Other"],
      "Blood Group": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
      "Marital Status": [
        "Single (never married)",
        "Married",
        "Divorced",
        "Widowed",
        "Separated",
      ],
      Department: departments.map((d) => d.name),
      "Sub Department": subDepartments.map((d) => d.name),
      "Job Title": jobTitles.map((t) => t.title),
      "Job Type": ["Full-time", "Part-time", "Contract", "Internship"],
      "Employee Status": ["ACTIVE", "On Leave", "Terminated", "Suspended"],
      "ID Type": ["National ID", "Passport"],
      Citizenship: ["Kenyan", "Non-Kenyan"],
      "Has Disability": ["Yes", "No"],
      "Employee Type": ["Primary Employee", "Secondary Employee", "Consultant"],
      "Pays PAYE": ["Yes", "No"],
      "Pays NSSF": ["Yes", "No"],
      "Pays HELB": ["Yes", "No"],
      "Pays Housing Levy": ["Yes", "No"],
      "Pays SHIF": ["Yes", "No"],
      "Contract Type": [
        "Permanent and Pensionable",
        "Fixed-Term Contract",
        "Casual Employment",
        "Probationary Contracts",
        "Contract for Services",
        "Apprenticeship/Indentured Learnership",
      ],
      "Contract Status": ["ACTIVE", "EXPIRED", "TERMINATED"],
      "Payment Method": ["BANK", "MOBILE", "CASH"],
      "Mobile Type": ["M-Pesa", "Airtel Money", "T-Kash"],
    };

    // 3. Create workbook & worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Employees");

    // 4. Add header row
    const headerRow = worksheet.addRow(templateHeaders);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9E1F2" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    worksheet.columns.forEach((column, index) => {
      const header = templateHeaders[index];
      column.width = header.length < 15 ? 15 : header.length + 5;

      if (
        header.startsWith("Date of Birth") ||
        header.startsWith("Hire Date") ||
        header.startsWith("Employee Status Effective Date") ||
        header.startsWith("Start Date") ||
        header.startsWith("End Date") ||
        header.startsWith("Probation End Date")
      ) {
        column.numFmt = "yyyy-mm-dd";
      }
    });
    // 5. Add dropdowns dynamically (up to 500 rows)
    headerRow.eachCell((cell, colNumber) => {
      const header = cell.value;
      if (dropdownOptions[header] && dropdownOptions[header].length > 0) {
        worksheet.dataValidations.add(
          `${worksheet.getColumn(colNumber).letter}2:${
            worksheet.getColumn(colNumber).letter
          }1000`,
          {
            type: "list",
            allowBlank: true,
            formulae: [`"${dropdownOptions[header].join(",")}"`],
          },
        );
      }
    });

    // 8. Stream workbook to response
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Employee_Import_Template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating employee template:", error);
    res.status(500).json({ error: error.message });
  }
};
