import supabase from "../libs/supabaseClient.js";
import { authorize } from "../utils/authorize.js";

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

export const createDeductionType = async (req, res) => {
  const { companyId } = req.params;
  const {
    name,
    description,
    is_pre_tax = false,
    has_maximum_value = false,
    maximum_value = null,
    code,
  } = req.body;

  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "PAYROLL", "can_write");
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to manage deduction types for this company.",
      });
    }

    // 🔒 Enforce regulatory rules
    if (code === "MORTGAGE_INTEREST") {
      if (maximum_value !== 30000) {
        return res.status(400).json({
          error: "Mortgage interest maximum must be 30,000.",
        });
      }
    }

    if (code === "PRMF") {
      if (maximum_value !== 15000) {
        return res.status(400).json({
          error: "PRMF maximum must be 15,000.",
        });
      }
    }

    const { data, error } = await supabase
      .from("deduction_types")
      .insert([
        {
          company_id: companyId,
          name,
          description,
          is_pre_tax,
          has_maximum_value,
          maximum_value,
          code,
        },
      ])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(400).json({
          error: "Deduction type with this name or code already exists.",
        });
      }
      throw error;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Create deduction type error:", err);
    res.status(500).json({ error: "Failed to create deduction type" });
  }
};

export const getDeductionTypes = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "PAYROLL", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to access deduction types.",
      });
    }

    const { data, error } = await supabase
      .from("deduction_types")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deduction types" });
  }
};

export const getDeductionTypeById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "PAYROLL", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to access this deduction type.",
      });
    }

    const { data, error } = await supabase
      .from("deduction_types")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(404).json({ error: "Deduction type not found" });
  }
};

export const updateDeductionType = async (req, res) => {
  const { companyId, id } = req.params;
  const { name, description, is_pre_tax, has_maximum_value, maximum_value } =
    req.body;

  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "PAYROLL", "can_write");
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update this deduction type.",
      });
    }

    // Fetch existing
    const { data: existing, error: fetchError } = await supabase
      .from("deduction_types")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Deduction type not found." });
    }

    // 🔒 Lock regulatory logic
    if (existing.code === "MORTGAGE_INTEREST") {
      if (maximum_value !== 30000) {
        return res.status(400).json({
          error: "Mortgage interest maximum cannot be modified.",
        });
      }
    }

    if (existing.code === "PRMF") {
      if (maximum_value !== 15000) {
        return res.status(400).json({
          error: "PRMF maximum cannot be modified.",
        });
      }
    }

    const { data, error } = await supabase
      .from("deduction_types")
      .update({
        name,
        description,
        is_pre_tax,
        has_maximum_value,
        maximum_value,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to update deduction type" });
  }
};

export const deleteDeductionType = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "PAYROLL", "can_delete");
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete this deduction type.",
      });
    }

    // Check if used in deductions
    const { count } = await supabase
      .from("deductions")
      .select("id", { count: "exact", head: true })
      .eq("deduction_type_id", id);

    if (count > 0) {
      return res.status(400).json({
        error: "Cannot delete deduction type already assigned.",
      });
    }

    const { error } = await supabase
      .from("deduction_types")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) throw error;

    res.json({ message: "Deduction type deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete deduction type" });
  }
};
