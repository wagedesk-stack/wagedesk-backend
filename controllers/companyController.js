import supabase from "../libs/supabaseClient.js";
import { authorize } from "../utils/authorize.js";
import { v4 as uuidv4 } from "uuid";

const checkCompanyAccess = async (companyId, userId, module, rule) => {
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
    .maybeSingle();

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
// --- Company Profile ---
export const createCompany = async (req, res) => {
  const userId = req.user.id;
  const {
    id,
    workspace_id,

    // Business info
    business_name,
    industry,
    kra_pin,
    company_email,
    company_phone,
    location,

    // Statutory
    nssf_employer,
    shif_employer,
    housing_levy_employer,
    helb_employer,
    // Bank
    bank_name,
    branch_name,
    account_name,
    account_number,
  } = req.body;

  const logoFile = req.file;

  if (!business_name) {
    return res.status(400).json({ error: "Business name is required." });
  }

  try {
    const { data: workspaceUser } = await supabase
      .from("workspace_users")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!workspaceUser) {
      return res.status(403).json({
        error: "You are not authorized to create a company in this workspace.",
      });
    }

    let logoUrl = "";

    // 1. Upload logo to Supabase Storage if a file is provided
    if (logoFile) {
      const fileExt = logoFile.originalname.split(".").pop();
      const fileName = `${workspace_id}/${uuidv4()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

      if (uploadError) {
        console.error("Logo upload error:", uploadError);
        throw new Error("Failed to upload logo.");
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("company-logos").getPublicUrl(fileName);

      logoUrl = publicUrl;
    }

    const payload = {
      ...(id && { id }),
      workspace_id,
      business_name,
      industry,
      kra_pin,
      company_email,
      company_phone,
      location,
      nssf_employer,
      shif_employer,
      housing_levy_employer,
      helb_employer,
      bank_name,
      branch_name,
      account_name,
      account_number,
      logo_url: logoUrl || req.body.logo_url,
      status: "PENDING",
    };

    // Remove undefined values (VERY IMPORTANT)
    Object.keys(payload).forEach(
      (key) => payload[key] === undefined && delete payload[key],
    );

    const { data: company, error: insertError } = await supabase
      .from("companies")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();

    if (insertError) {
      console.error("Company insert error:", insertError);
      throw new Error("Failed to save company details.");
    }

    //assing company role
    let companyRole = "VIEWER";

    switch (workspaceUser.role) {
      case "OWNER":
      case "ADMIN":
        companyRole = "ADMIN";
        break;
      case "MANAGER":
        companyRole = "MANAGER";
        break;
      default:
        companyRole = "VIEWER";
    }

    const { error: membershipError } = await supabase
      .from("company_users")
      .insert({
        company_id: company.id,
        user_id: userId,
        role: companyRole,
      });

    if (membershipError) throw membershipError;

    res.status(201).json(data);
  } catch (error) {
    console.error("Create company error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get Company Details
export const getCompanyDetails = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId; // From verifyToken middleware

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view this company.",
      });
    }

    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (error) {
      console.error("Get company error:", error);
      return res.status(404).json({ error: "Company not found" });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Get company error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update Company Details (Partial Update)
export const updateCompanyDetails = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const updates = req.body;
  const logoFile = req.file;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to Update this company.",
      });
    }

    let logoUrl = updates.logo_url;

    // Upload new logo if provided
    if (logoFile) {
      const fileExt = logoFile.originalname.split(".").pop();
      const fileName = `${workspace_id}/${companyId}/${uuidv4()}.${fileExt}`;

      // Delete old logo if exists
      const { data: existing } = await supabase
        .from("companies")
        .select("logo_url")
        .eq("id", companyId)
        .single();

      if (existing?.logo_url) {
        const oldFileName = existing.logo_url.split("/").pop();
        await supabase.storage
          .from("company-logos")
          .remove([`${workspace_id}/${companyId}/${oldFileName}`]);
      }

      // Upload new logo
      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

      if (uploadError) throw new Error("Failed to upload logo.");

      const {
        data: { publicUrl },
      } = supabase.storage.from("company-logos").getPublicUrl(fileName);

      logoUrl = publicUrl;
    }

    // Remove undefined values
    Object.keys(updates).forEach(
      (key) => updates[key] === undefined && delete updates[key],
    );

    // Only include fields that are present in the updates
    const payload = {
      ...updates,
      ...(logoUrl && { logo_url: logoUrl }),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("companies")
      .update(payload)
      .eq("id", companyId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error("Update company error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get Company Settings Summary
export const getCompanySettingsSummary = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view this company.",
      });
    }
    // Get company basic info
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "id, business_name, kra_pin, company_email, company_phone, location, logo_url, status, created_at",
      )
      .eq("id", companyId)
      .single();

    if (companyError) throw companyError;

    // Get counts for summary
    const { count: employeesCount } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId);

    const { count: departmentsCount } = await supabase
      .from("departments")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId);

    res.status(200).json({
      ...company,
      employees_count: employeesCount || 0,
      departments_count: departmentsCount || 0,
    });
  } catch (error) {
    console.error("Get settings summary error:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- Departments ---
export const manageDepartments = {
  list: async (req, res) => {
    const { companyId } = req.params;
    const userId = req.userId;

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view departments.",
      });
    }
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .eq("company_id", req.params.companyId);
    res.json(data || []);
  },
  create: async (req, res) => {
    const { company_id, name } = req.body;
    const userId = req.userId;

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      company_id,
      userId,
      "ORG_SETTINGS",
      "can_write",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to create departments.",
      });
    }

    const { data, error } = await supabase
      .from("departments")
      .insert([{ company_id, name }])
      .select()
      .single();
    if (error) return res.status(400).json(error);
    res.json(data);
  },
  update: async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.userId;

    // First get the company_id for this department
    const { data: department, error: deptError } = await supabase
      .from("departments")
      .select("company_id")
      .eq("id", id)
      .single();

    if (deptError || !department) {
      return res.status(404).json({ error: "Department not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      department.company_id,
      userId,
      "ORG_SETTINGS",
      "can_write",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update departments.",
      });
    }

    const { data, error } = await supabase
      .from("departments")
      .update({ name })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json(error);
    res.json(data);
  },
  delete: async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    // First get the company_id for this department
    const { data: department, error: deptError } = await supabase
      .from("departments")
      .select("company_id")
      .eq("id", id)
      .single();

    if (deptError || !department) {
      return res.status(404).json({ error: "Department not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      department.company_id,
      userId,
      "ORG_SETTINGS",
      "can_delete",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete departments.",
      });
    }
    const { error } = await supabase.from("departments").delete().eq("id", id);

    if (error) return res.status(400).json(error);
    res.status(204).send();
  },
};

// --- Sub-Departments / Projects / Sections ---
export const manageSubDepartments = {
  list: async (req, res) => {
    const { companyId } = req.params;
    const userId = req.userId;

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view sub-departments.",
      });
    }

    const { data, error } = await supabase
      .from("sub_departments")
      .select("*, departments(name)")
      .eq("company_id", companyId);

    if (error) return res.status(400).json(error);
    res.json(data || []);
  },
  create: async (req, res) => {
    const { company_id, department_id, name, type } = req.body;
    const userId = req.userId;

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      company_id,
      userId,
      "ORG_SETTINGS",
      "can_write",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to create sub-departments.",
      });
    }

    const { data, error } = await supabase
      .from("sub_departments")
      .insert([{ company_id, department_id, name, type }])
      .select()
      .single();

    if (error) return res.status(400).json(error);
    res.json(data);
  },
  update: async (req, res) => {
    const { id } = req.params;
    const { name, type, department_id } = req.body;
    const userId = req.userId;

    // First get the company_id for this sub-department
    const { data: subDept, error: subError } = await supabase
      .from("sub_departments")
      .select("company_id")
      .eq("id", id)
      .single();

    if (subError || !subDept) {
      return res.status(404).json({ error: "Sub-department not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      subDept.company_id,
      userId,
      "ORG_SETTINGS",
      "can_write",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update sub-departments.",
      });
    }

    const { data, error } = await supabase
      .from("sub_departments")
      .update({ name, type, department_id })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json(error);
    res.json(data);
  },
  delete: async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    // First get the company_id for this sub-department
    const { data: subDept, error: subError } = await supabase
      .from("sub_departments")
      .select("company_id")
      .eq("id", id)
      .single();

    if (subError || !subDept) {
      return res.status(404).json({ error: "Sub-department not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      subDept.company_id,
      userId,
      "ORG_SETTINGS",
      "can_delete",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete sub-departments.",
      });
    }
    const { error } = await supabase
      .from("sub_departments")
      .delete()
      .eq("id", id);

    if (error) return res.status(400).json(error);
    res.status(204).send();
  },
};

// --- Job Titles ---
export const manageJobTitles = {
  list: async (req, res) => {
    const { companyId } = req.params;
    const userId = req.userId;

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read",
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view job titles.",
      });
    }

    const { data, error } = await supabase
      .from("job_titles")
      .select("*")
      .eq("company_id", req.params.companyId);

    if (error) return res.status(400).json(error);
    res.json(data || []);
  },
  create: async (req, res) => {
     const { company_id, title } = req.body;
    const userId = req.userId;

     // Check authorization
    const isAuthorized = await checkCompanyAccess(
      company_id,
      userId,
      "ORG_SETTINGS",
      "can_write"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to create job titles.",
      });
    }

    const { data, error } = await supabase
      .from("job_titles")
      .insert([{ company_id, title }])
      .select()
      .single();

    if (error) return res.status(400).json(error);
    res.json(data);
  },
  update: async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
     const userId = req.userId;

     // First get the company_id for this job title
    const { data: jobTitle, error: jobError } = await supabase
      .from("job_titles")
      .select("company_id")
      .eq("id", id)
      .single();

    if (jobError || !jobTitle) {
      return res.status(404).json({ error: "Job title not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      jobTitle.company_id,
      userId,
      "ORG_SETTINGS",
      "can_write"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update job titles.",
      });
    }

    const { data, error } = await supabase
      .from("job_titles")
      .update({ title })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json(error);
    res.json(data);
  },
  delete: async (req, res) => {
    const { id } = req.params;
    const userId = req.userId;

    // First get the company_id for this job title
    const { data: jobTitle, error: jobError } = await supabase
      .from("job_titles")
      .select("company_id")
      .eq("id", id)
      .single();

    if (jobError || !jobTitle) {
      return res.status(404).json({ error: "Job title not found" });
    }

    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      jobTitle.company_id,
      userId,
      "ORG_SETTINGS",
      "can_delete"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete job titles.",
      });
    }

    const { error } = await supabase
      .from("job_titles")
      .delete()
      .eq("id", id);

    if (error) return res.status(400).json(error);
    res.status(204).send();
  },
};
