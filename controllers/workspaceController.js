import supabase from "../libs/supabaseClient.js";

export const getAuthContext = async (req, res) => {
  const userId = req.user.id;

  try {
    // workspace roles
    const { data: workspaces, error } = await supabase
      .from("workspace_users")
      .select(`
        workspace_id,
        role,
        full_names,
        email,
        workspaces (
          id,
          name,
          status,
          companies (
            id,
            business_name,
            industry,
            logo_url,
            status
          )
        )
      `)
      .eq("user_id", userId);

      if (error) throw error;

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
      },
      workspaces,
    });
  } catch (error) {
    res.status(500).json({error: error.message });
  }
};
