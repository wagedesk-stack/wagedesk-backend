import supabase from "../libs/supabaseClient.js";

export const getAuthContext = async (req, res) => {
  const userId = req.user.id;

  try {
    // workspace roles
    const { data: workspaceMemberships, error: workspaceError } = await supabase
      .from("workspace_users")
      .select(
        `
          workspace_id,
          role,
          full_names,
          email,
          workspaces (
            id,
            name,
            status
          )
        `,
      )
      .eq("user_id", userId);

    if (workspaceError) throw workspaceError;

    // 2️ Get company memberships
    const { data: companyMemberships, error: companyError } = await supabase
      .from("company_users")
      .select(
        `
          role,
          company_id,
          companies (
            id,
            business_name,
            industry,
            logo_url,
            status,
            workspace_id
          )
        `,
      )
      .eq("user_id", userId);

    if (companyError) throw companyError;

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
      },
      workspaces: workspaceMemberships,
      companies: companyMemberships,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
