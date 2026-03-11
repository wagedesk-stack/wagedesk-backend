import supabase from "../libs/supabaseClient.js";

export const getPayrollReportData = async (req, res) => {
  const { companyId, runId } = req.params;
  const userId = req.userId;
  const { view } = req.query;
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
        payroll_reviews ( 
          id, 
          status, 
          company_reviewer_id,
          company_reviewers (
            reviewer_level
          )
        )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) throw error;

    // PROFESSIONAL UX: Identify top 4 allowance names across all employees
    const allowanceCounts = {};
    details.forEach((detail) => {
      detail.allowances_details?.forEach((allow) => {
        allowanceCounts[allow.name] = (allowanceCounts[allow.name] || 0) + 1;
      });
    });

    const topAllowanceNames = Object.entries(allowanceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);

   // Fetch all reviewers for this company with their levels
    const { data: allReviewers } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId);

    // Separate reviewers by level
    const level1Reviewers = allReviewers?.filter(r => r.reviewer_level === 1) || [];
    const level2Reviewers = allReviewers?.filter(r => r.reviewer_level === 2) || [];
    const level3Reviewers = allReviewers?.filter(r => r.reviewer_level === 3) || [];

    const reports = details.map((item) => {
      // Find the specific review entry for the current reviewer
      const myReview = item.payroll_reviews?.find(
        (r) => r.company_reviewer_id === reviewer?.id,
      );
      const emp = item.employees;
      const fullName = `${emp.first_name} ${emp.middle_name || ""} ${emp.last_name}`;
      let topAllowances = {};
      let othersSum = 0;

      // Initialize top columns with 0
      topAllowanceNames.forEach((name) => (topAllowances[name] = 0));

      item.allowances_details?.forEach((allow) => {
        if (topAllowanceNames.includes(allow.name)) {
          topAllowances[allow.name] = allow.value;
        } else if (allow.is_cash) {
          othersSum += allow.value;
        }
      });

      // Group reviews by reviewer level
      const reviewsByLevel = {
        1: [],
        2: [],
        3: []
      };

      item.payroll_reviews?.forEach(review => {
        const level = review.company_reviewers?.reviewer_level;
        if (level && [1, 2, 3].includes(level)) {
          reviewsByLevel[level].push(review);
        }
      });

      // Check if any level 1 or 2 reviewer has rejected
      const hasLevel1Rejection = reviewsByLevel[1].some(r => r.status === "REJECTED");
      const hasLevel2Rejection = reviewsByLevel[2].some(r => r.status === "REJECTED");
      
      // Check if all level 1 reviewers have approved
      const allLevel1Approved = level1Reviewers.length > 0 
        ? reviewsByLevel[1].length === level1Reviewers.length && 
          reviewsByLevel[1].every(r => r.status === "APPROVED")
        : true; // If no level 1 reviewers, consider it satisfied
      
      // Check if all level 2 reviewers have approved
      const allLevel2Approved = level2Reviewers.length > 0
        ? reviewsByLevel[2].length === level2Reviewers.length && 
          reviewsByLevel[2].every(r => r.status === "APPROVED")
        : true; // If no level 2 reviewers, consider it satisfied

      let reviewStatus = "PENDING";
      
      if (hasLevel1Rejection || hasLevel2Rejection) {
        reviewStatus = "REJECTED";
      } else if (allLevel1Approved && allLevel2Approved) {
        reviewStatus = "APPROVED";
      }
      // If neither condition is met, status remains "PENDING"


      return {
        // Shared Fields
        id: item.id,
        reviewId: myReview?.id, // Essential for the update call
        myStatus: myReview?.status || "PENDING",
        employeeId: emp.id,
        fullName,
        jobTitle: emp.job_titles?.title,
        department: emp.departments?.name,
        basicSalary: item.basic_salary,
        absent_days: item.absent_days || 0,
        absent_days_deduction: item.absent_days_deduction || 0,
        grossPay: item.gross_pay,
        helbDeduction: item.helb_deduction,
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
        topAllowances, // Specific columns
        otherCashAllowances: othersSum,
        // Deductions Specific
        employmentType: emp.employee_type,
        paye: item.paye_tax,
        nssf: item.nssf_deduction,
        shif: item.shif_deduction,
        housingLevy: item.housing_levy_deduction,
        otherDeductions: item.total_other_deductions - item.helb_deduction,

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

    // Check if this is an earnings-specific request (you can add a query param)
    // Add this line at the beginning of your function

    if (view === "earnings") {
      // Return with dynamic columns for earnings view
      res.json({
        data: reports,
        columns: topAllowanceNames,
      });
      //console.log(reports)
    } else {
      // Return just the array for other views
      res.json(reports);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getLatestPayrollOverview = async (req, res) => {
  const { companyId } = req.params;

  try {
    // 1. Get the most recent payroll run
    const { data: latestRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (runError || !latestRun) {
      return res
        .status(404)
        .json({ message: "No payroll runs found for this company." });
    }

    // 2. Fetch all details for this specific run including employee department info
    const { data: details, error: detailsError } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employees (
          departments ( name )
        )
      `,
      )
      .eq("payroll_run_id", latestRun.id);

    if (detailsError) throw detailsError;

    // 3. Aggregate Data for Charts
    const deptMap = {};
    let totalBasic = 0;
    let totalCashAllowances = 0;
    let totalNonCash = 0;
    let totalDeductions = 0;

    details.forEach((item) => {
      const deptName = item.employees?.departments?.name || "Unassigned";

      // Net Pay by Department
      deptMap[deptName] = (deptMap[deptName] || 0) + Number(item.net_pay);

      // Cost Breakdown sums
      totalBasic += Number(item.basic_salary);
      totalCashAllowances += Number(item.total_cash_allowances);
      totalNonCash += Number(item.total_non_cash_benefits);
      totalDeductions += Number(item.total_other_deductions);
    });

    const response = {
      summary: {
        payrollId: latestRun.id,
        payrollMonth: latestRun.payroll_month,
        payrollYear: latestRun.payroll_year,
        status: latestRun.status,
        employeesPaid: details.length,
        grossPay: latestRun.total_gross_pay,
        netPay: latestRun.total_net_pay,
        statutory: latestRun.total_statutory_deductions,
      },
      breakdown: [
        { name: "Basic Salary", value: totalBasic },
        { name: "Cash Allowances", value: totalCashAllowances },
        { name: "Non-Cash Benefits", value: totalNonCash },
        { name: "Deductions", value: totalDeductions },
      ],
      statutoryDetails: [
        {
          name: "PAYE",
          value: details.reduce((sum, i) => sum + Number(i.paye_tax), 0),
        },
        {
          name: "NSSF",
          value: details.reduce((sum, i) => sum + Number(i.nssf_deduction), 0),
        },
        {
          name: "SHIF",
          value: details.reduce((sum, i) => sum + Number(i.shif_deduction), 0),
        },
        {
          name: "Housing Levy",
          value: details.reduce(
            (sum, i) => sum + Number(i.housing_levy_deduction),
            0,
          ),
        },
        {
          name: "HELB",
          value: details.reduce((sum, i) => sum + Number(i.helb_deduction), 0),
        },
      ],
      departmentalNetPay: Object.keys(deptMap).map((dept) => ({
        department: dept,
        netPay: deptMap[dept],
      })),
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
