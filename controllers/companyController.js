import supabase from "../libs/supabaseClient.js";

// --- Company Profile ---
export const createCompany = async (req, res) => {
  try {
    const {
      workspace_id,

      // Business info
      business_name,
      industry,
      kra_pin,
      email,
      phone,
      address,

      // Statutory
      nssf_number,
      shif_number,
      housing_levy_number,
      helb_number,

      // Bank
      bank_name,
      bank_branch,
      account_name,
      account_number,
      // Branding
      logo_url,
    } = req.body;

    const payload = {
      workspace_id,

      business_name,
      industry,
      kra_pin,
      email,
      phone,
      address,

      nssf_number,
      shif_number,
      housing_levy_number,
      helb_number,

      bank_name,
      bank_branch,
      account_name,
      account_number,

      logo_url,

      status: "PENDING",
    };

    // Remove undefined values (VERY IMPORTANT)
    Object.keys(payload).forEach(
      (key) => payload[key] === undefined && delete payload[key],
    );

    const { data, error } = await supabase
      .from("companies")
      .insert([payload])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error("Create company error:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- Departments ---
export const manageDepartments = {
  list: async (req, res) => {
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .eq("company_id", req.params.companyId);
    res.json(data || []);
  },
  create: async (req, res) => {
    const payload = {
    ...req.body,
    company_id: req.params.companyId,
  };

    const { data, error } = await supabase
      .from("departments")
      .insert([payload])
      .select()
      .single();
    if (error) return res.status(400).json(error);
    res.json(data);
  },
  delete: async (req, res) => {
    await supabase.from("departments").delete().eq("id", req.params.id);
    res.status(204).send();
  },
};

// --- Sub-Departments / Projects / Sections ---
export const manageSubDepartments = {
  list: async (req, res) => {
    const { data, error } = await supabase
      .from("sub_departments")
      .select("*, departments(name)")
      .eq("company_id", req.params.companyId);
    res.json(data || []);
  },
  create: async (req, res) => {
    const { data, error } = await supabase
      .from("sub_departments")
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json(error);
    res.json(data);
  },
};

// --- Job Titles ---
export const manageJobTitles = {
  list: async (req, res) => {
    const { data, error } = await supabase
      .from("job_titles")
      .select("*")
      .eq("company_id", req.params.companyId);
    res.json(data || []);
  },
  create: async (req, res) => {
    const { data, error } = await supabase
      .from("job_titles")
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json(error);
    res.json(data);
  },
};
