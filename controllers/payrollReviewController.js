import supabase from "../libs/supabaseClient.js";

export const getPayrollReportData = async (req, res) => {
  const { companyId, runId } = req.params;
  const userId = req.userId;
  try {
    // 1. Get the reviewer's ID for this company based on the logged-in user
    const { data: reviewer } = await supabase
      .from("company_reviewers")
      .select("id")
      .eq("company_id", companyId)
      .eq(
        "company_user_id",
        (
          await supabase
            .from("company_users")
            .select("id")
            .eq("user_id", userId)
            .eq("company_id", companyId)
            .single()
        ).data?.id,
      )
      .single();

    //Fetch company details for bank info
    const { data: companyDetails, error: companyError } = await supabase
      .from("companies")
      .select("account_number")
      .eq("id", companyId);

    if (companyError) throw companyError;

    // Fetch all details for the run including employee and reviewer info
    const { data: details, error } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employees (
        id, first_name, last_name, middle_name, employee_type, email,
          departments ( name ),
          job_titles ( title )
        ),
        payroll_reviews ( id, status, company_reviewer_id )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) throw error;

    // Fetch total number of reviewers for this company to determine approval status
    const { count: totalReviewers } = await supabase
      .from("company_reviewers")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId);

    const reports = details.map((item) => {
        // Find the specific review entry for the current reviewer
      const myReview = item.payroll_reviews?.find(r => r.company_reviewer_id === reviewer?.id);
      const emp = item.employees;
      const fullName = `${emp.first_name} ${emp.middle_name || ""} ${emp.last_name}`;

      // Calculate dynamic status for Review & Approve
      const approvedCount =
        item.payroll_reviews?.filter((r) => r.status === "APPROVED").length ||
        0;
      const rejectedCount =
        item.payroll_reviews?.filter((r) => r.status === "REJECTED").length ||
        0;

      let reviewStatus = "PENDING";
      if (rejectedCount > 0) reviewStatus = "REJECTED";
      else if (approvedCount >= totalReviewers && totalReviewers > 0)
        reviewStatus = "APPROVED";

      return {
        // Shared Fields
        id: item.id,
        reviewId: myReview?.id, // Essential for the update call
        myStatus: myReview?.status || 'PENDING',
        employeeId: emp.id,
        fullName,
        jobTitle: emp.job_titles?.title,
        department: emp.departments?.name,
        basicSalary: item.basic_salary,
        grossPay: item.gross_pay,
        netPay: item.net_pay,

        // Overview Specific
        taxedBenefits: item.allowances_details
          ?.filter((a) => a.is_taxable)
          .reduce((sum, a) => sum + a.value, 0),
        nonTaxedBenefits: item.allowances_details
          ?.filter((a) => !a.is_taxable)
          .reduce((sum, a) => sum + a.value, 0),
        totalDeductions: item.total_deductions,

        // Earnings Specific
        cashAllowances: item.allowances_details?.filter(
          (a) => a.type === "CASH",
        ),
        otherAllowances: item.allowances_details
          ?.filter((a) => a.type !== "CASH")
          .reduce((sum, a) => sum + a.value, 0),

        // Deductions Specific
        employmentType: emp.employee_type,
        paye: item.paye_tax,
        nssf: item.nssf_deduction,
        shif: item.shif_deduction,
        housingLevy: item.housing_levy_deduction,
        otherDeductions: item.total_other_deductions,

        // Review & Approve Specific
        paymentMethod: item.payment_method,
        reviewStatus,

        // Payment Table Specific
        companyAccountNumber: companyDetails[0]?.account_number || "",
        mobileType: item.mobile_type,
        mobilePhone: item.mobile_phone,
        bankDetails: {
          accountNumber: item.account_number,
          accountName: item.account_name,
          bankName: item.bank_name,
          bankCode: item.bank_code,
          branchName: item.branch_name,
          branchCode: item.branch_code,
        },

        // Payslip Specific
        email: emp.email,
      };
    });

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
