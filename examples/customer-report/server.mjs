// Trusted customer code. MeterFlo supplies a versioned, permission-scoped context.
// No core edits, database connection strings or synthetic customer data are needed.
export const reports = {
  async projects(context) {
    const projects = await context.getProjects();
    return {
      title: "Customer Project Report",
      columns: ["Project ID", "Project", "Active"],
      rows: projects.map(project => [project.id, project.name, project.isActive ? "Yes" : "No"])
    };
  }
};
