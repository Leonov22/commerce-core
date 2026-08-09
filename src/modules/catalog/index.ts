/**
 * Public entry point for the catalog module. Other modules must import
 * catalog functionality through here rather than reaching into
 * catalog-internal files, per the project's module boundary rules.
 */
export { getCatalogProductById } from "@/modules/catalog/presentation/catalog-data";
