<div>
    <img src='https://github.com/mapbiomas-brazil/cerrado/blob/mapbiomas60/2-general-map/www/ipam_logo.jpg?raw=true' height='auto' width='180' align='right'>
    <h1>Cerrado biome - Collection 5.0</h1>
</div>

Developed by [Instituto de Pesquisa Ambiental da Amazônia - IPAM](https://ipam.org.br/)<br>

## About
This folder contains the scripts used to classify and filter land use and land cover data for the **Cerrado** biome.

For detailed information about the classification process and methodology, refer to the Cerrado biome appendix in the [Algorithm Theoretical Basis Document (ATBD)](https://mapbiomas.org/download-dos-atbds).

## How to use
1. Create an account in Google Earth Engine plataform.
2. Download or clone this repository to your local workspace.
   
## Pre-processing
- **Step 01**: Build stable pixels from Collection 4.1 and save them as a new asset.  
- **Step 02**: Calculate class area proportions by region to guide training sample generation.  
- **Step 03**: Export balanced training samples for each region.  
- **Step 04**: Export training samples for each year.

## Classification
- **Step 05**: Export classification maps for each region.

## Post-processing
- **Step 06**: Merge classification results and apply a Gap Fill filter.  
- **Step 07a**: Generate an asset that tracks classification changes over time.  
- **Step 07b**: Apply an incident filter to reduce classification noise.  
- **Step 08**: Apply a temporal consistency filter.  
- **Step 09**: Apply a spatial consistency filter.  
- **Step 10**: Apply a frequency-based filter to refine results.

## Contact
For clarification or issue/bug report, please write to <dhemerson.costa@ipam.org.br and barbara.silva@ipam.org.br>
