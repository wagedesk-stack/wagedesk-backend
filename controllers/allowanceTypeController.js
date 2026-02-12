import supabase from "../libs/supabaseClient.js";
import { authorize } from "../utils/authorize.js";

const checkCompanyAccess = async (companyId, userId, module, rule) => {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("workspace_id")
    .eq("id", companyId)
    .single();

  if (companyError || !company) return false;

  const { data: workspaceUser, error: workspaceError } = await supabase
    .from("workspace_users")
    .select("id")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", userId)
    .single();

  if (workspaceError || !workspaceUser) return false;

  const auth = await authorize(userId, company.workspace_id, module, rule);

  if (!auth.allowed) return false;

  return true;
};

export const createAllowanceType = async (req, res) => {
  const { companyId } = req.params;

  const {
    name,
    description,
    is_cash = true,
    is_taxable = true,
    has_maximum_value = false,
    maximum_value = null,
    code,
  } = req.body;

  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to manage allowance types.",
      });
    }

    /* 🔒 Business Rules Enforcement */

    if (is_cash && !is_taxable) {
      return res.status(400).json({
        error: "Cash allowances must be taxable.",
      });
    }

    if (!is_cash) {
      if (["CAR", "HOUSING"].includes(code) && !is_taxable) {
        return res.status(400).json({
          error: "Car and Housing benefits must be taxable.",
        });
      }

      if (code === "MEAL" && !is_taxable) {
        return res.status(400).json({
          error: "Meal benefit must be taxable (first 5,000 exempt handled in payroll run).",
        });
      }
    }

    const { data, error } = await supabase
      .from("allowance_types")
      .insert([
        {
          company_id: companyId,
          name,
          description,
          is_cash,
          is_taxable,
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
          error:
            "Allowance type with this name or code already exists for this company.",
        });
      }
      throw error;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Create allowance type error:", err);
    res.status(500).json({
      error: "Failed to create allowance type.",
    });
  }
};

export const getAllowanceTypes = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to access allowance types.",
      });
    }

    const { data, error } = await supabase
      .from("allowance_types")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch allowance types.",
    });
  }
};

export const getAllowanceTypeById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to access this allowance type.",
      });
    }

    const { data, error } = await supabase
      .from("allowance_types")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(404).json({
      error: "Allowance type not found.",
    });
  }
};

export const updateAllowanceType = async (req, res) => {
  const { companyId, id } = req.params;

  const {
    name,
    description,
    is_cash,
    is_taxable,
    has_maximum_value,
    maximum_value,
  } = req.body;

  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update allowance type.",
      });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("allowance_types")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        error: "Allowance type not found.",
      });
    }

    /* 🔒 Business Rules */

    if (is_cash && !is_taxable) {
      return res.status(400).json({
        error: "Cash allowances must remain taxable.",
      });
    }

    if (!is_cash) {
      if (["CAR", "HOUSING"].includes(existing.code) && !is_taxable) {
        return res.status(400).json({
          error: "Car and Housing benefits must remain taxable.",
        });
      }
    }

    const { data, error } = await supabase
      .from("allowance_types")
      .update({
        name,
        description,
        is_cash,
        is_taxable,
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
    res.status(500).json({
      error: "Failed to update allowance type.",
    });
  }
};


export const deleteAllowanceType = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_delete"
    );

    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete allowance type.",
      });
    }

    // Prevent deletion if assigned
    const { count } = await supabase
      .from("allowances")
      .select("id", { count: "exact", head: true })
      .eq("allowance_type_id", id);

    if (count > 0) {
      return res.status(400).json({
        error: "Cannot delete allowance type already assigned.",
      });
    }

    const { error } = await supabase
      .from("allowance_types")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) throw error;

    res.json({
      message: "Allowance type deleted successfully.",
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to delete allowance type.",
    });
  }
};
